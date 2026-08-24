import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { FAILURE_CODES, planReversal } from "@/services/billing/settlement";
import { DeliveryFailure, describeFailure, inStage } from "@/services/delivery";
import {
  generatedStorageKey,
  sniffGeneratedMime,
} from "@/services/storage/assets";

/**
 * The refund policy, tested against the function that actually decides it.
 *
 * ## Why this file exists
 *
 * Sprint 5C.2 ran one controlled production generation. Replicate produced a
 * valid image, Atheos failed to store it, and the customer was left four credits
 * poorer with nothing delivered — and the whole suite was green while it
 * happened. It was green because the settlement tests re-expressed the policy in
 * SQL fixtures rather than calling the code, so a re-implementation and the
 * implementation could not disagree.
 *
 * `planReversal` was extracted to close exactly that gap. Every case below runs
 * the real decision, and the first one is the defect.
 */

const GEN = "gen_1";

/** The ledger state a current-model generation has at the moment of failure. */
function capturedReservation(keys: string[] = []) {
  return {
    generationId: GEN,
    keys: new Set([`reserve:${GEN}`, `capture:${GEN}`, ...keys]),
    reservedAmount: -4,
  };
}

describe("credits pay for delivery, not for a provider call", () => {
  it("refunds a captured charge when nothing was delivered", () => {
    /**
     * **The Sprint 5C.2 defect.**
     *
     * This returned `retained` because a `capture:` row existed. Capture is
     * written at submission — 0.4 s after the reservation and two minutes
     * before this generation failed — so that branch was true of every
     * generation before any of them could fail, and it disabled every refund
     * the previous sprint had built. Production proved it: 1 capture row, 0
     * release rows, one customer four credits down.
     */
    const plan = planReversal({
      ...capturedReservation(),
      hasDurableAsset: false,
    });

    expect(plan).toEqual({
      action: "reverse",
      key: `refund:${GEN}`,
      reason: "GENERATION_REFUND",
      outcome: "refunded",
      amount: 4,
    });
  });

  it("retains a captured charge when a durable asset exists", () => {
    // The other half of the rule, and the more expensive one to get wrong:
    // refunding somebody who has a working file hands back money for work they
    // can still use.
    expect(
      planReversal({ ...capturedReservation(), hasDurableAsset: true }),
    ).toEqual({ action: "retain" });
  });

  it("retains even when nothing was ever charged, if an asset exists", () => {
    // Asset check precedes every ledger consideration. A delivered generation
    // is never a refund candidate regardless of how it was paid for.
    expect(
      planReversal({
        generationId: GEN,
        keys: new Set(),
        hasDurableAsset: true,
      }),
    ).toEqual({ action: "retain" });
  });

  it("releases an uncaptured reservation rather than refunding it", () => {
    // Different events to the reporting queries: a release returns money that
    // never left, a refund returns money that did.
    expect(
      planReversal({
        generationId: GEN,
        keys: new Set([`reserve:${GEN}`]),
        reservedAmount: -4,
        hasDurableAsset: false,
      }),
    ).toMatchObject({ reason: "GENERATION_RELEASE", outcome: "released" });
  });

  it("refunds a legacy direct spend", () => {
    // Generations predating the reservation model. Both models still exist in
    // production, so both must settle correctly.
    expect(
      planReversal({
        generationId: GEN,
        keys: new Set([`spend:${GEN}`]),
        spentAmount: -90,
        hasDurableAsset: false,
      }),
    ).toMatchObject({
      key: `refund:${GEN}`,
      reason: "GENERATION_REFUND",
      amount: 90,
    });
  });
});

describe("reversing exactly once", () => {
  it("does nothing when a refund already exists", () => {
    expect(
      planReversal({
        ...capturedReservation([`refund:${GEN}`]),
        hasDurableAsset: false,
      }),
    ).toEqual({ action: "already" });
  });

  it("does nothing when a release already exists", () => {
    expect(
      planReversal({
        generationId: GEN,
        keys: new Set([`reserve:${GEN}`, `release:${GEN}`]),
        reservedAmount: -4,
        hasDurableAsset: false,
      }),
    ).toEqual({ action: "already" });
  });

  it("is stable under repetition — the plan never escalates", () => {
    /**
     * Twenty settlements of the same generation. The first writes
     * `refund:{id}`; every subsequent one sees that key and plans nothing.
     * The database's unique index is what enforces this under genuine
     * concurrency (`tests/db/settlement.test.ts`); this asserts the decision
     * layer never *asks* for a second reversal.
     */
    const keys = new Set([`reserve:${GEN}`, `capture:${GEN}`]);
    const outcomes: string[] = [];

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const plan = planReversal({
        generationId: GEN,
        keys,
        reservedAmount: -4,
        hasDurableAsset: false,
      });
      outcomes.push(plan.action);
      // Simulate the winner committing its ledger row.
      if (plan.action === "reverse") keys.add(plan.key);
    }

    expect(outcomes.filter((action) => action === "reverse")).toHaveLength(1);
    expect(outcomes.filter((action) => action === "already")).toHaveLength(19);
  });

  it("plans nothing when the customer was never charged", () => {
    expect(
      planReversal({
        generationId: GEN,
        keys: new Set(),
        hasDurableAsset: false,
      }),
    ).toEqual({ action: "none" });
  });

  it("plans nothing for a zero-credit charge", () => {
    // A free-tier or zero-priced run has nothing to give back, and a zero-value
    // ledger row would be noise in every report that reads them.
    expect(
      planReversal({
        generationId: GEN,
        keys: new Set([`reserve:${GEN}`]),
        reservedAmount: 0,
        hasDurableAsset: false,
      }),
    ).toEqual({ action: "none" });
  });
});

describe("failures are named by stage and safe to log", () => {
  it("reports the stage that actually failed", async () => {
    const thrown = await inStage("r2_upload", async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.1:443");
    }).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(DeliveryFailure);
    expect((thrown as DeliveryFailure).stage).toBe("r2_upload");
  });

  it("drops the message of an error it did not construct", async () => {
    /**
     * The failure this prevents: a `fetch` rejection whose message contains the
     * signed provider URL, logged verbatim next to the generation id. The
     * class name survives because `TypeError` and `S3ServiceException` mean
     * very different things; the message does not, because it cannot be
     * trusted not to carry a secret.
     */
    const secret = "https://replicate.delivery/x/out.png?token=SECRET_TOKEN";
    const described = describeFailure(
      new TypeError(`fetch failed ${secret}`),
      "provider_fetch",
    );

    expect(described.errorClass).toBe("TypeError");
    expect(JSON.stringify(described)).not.toContain("SECRET_TOKEN");
    expect(JSON.stringify(described)).not.toContain("replicate.delivery");
  });

  it("carries no field that could hold a URL, prompt or payload", () => {
    // Asserted on the shape rather than on one example, so a future field that
    // could carry free text fails here rather than in production.
    const described = describeFailure(new Error("x"), "r2_upload");
    expect(Object.keys(described).sort()).toEqual(
      ["code", "errorClass", "retryable", "stage"].sort(),
    );
  });

  it("keeps an AWS status code, which is safe and usually the answer", () => {
    // 403 means credentials, 404 means bucket. Both are diagnostic and neither
    // is a secret.
    const described = describeFailure(
      Object.assign(new Error("Access Denied"), {
        $metadata: { httpStatusCode: 403 },
      }),
      "r2_upload",
    );
    expect(described.status).toBe(403);
    expect(JSON.stringify(described)).not.toContain("Access Denied");
  });

  it("preserves a staged failure rather than re-wrapping it", async () => {
    // A validation rejection thrown inside a later stage must keep its own
    // stage and its non-retryable verdict.
    const inner = new DeliveryFailure({
      stage: "content_validation",
      code: FAILURE_CODES.INVALID_CONTENT_TYPE,
      retryable: false,
      message: "not a media file",
    });

    const thrown = await inStage("r2_upload", async () => {
      throw inner;
    }).catch((error: unknown) => error);

    expect(thrown).toBe(inner);
    expect(describeFailure(thrown, "r2_upload")).toMatchObject({
      stage: "content_validation",
      retryable: false,
    });
  });

  it("treats an unrecognised failure as retryable once", () => {
    // The common unrecognised fault is a transient network error, so one retry
    // is worth more than an immediate refund.
    expect(describeFailure(new Error("boom"), "provider_fetch")).toMatchObject({
      retryable: true,
      code: FAILURE_CODES.INTERNAL_FINALIZATION_FAILED,
    });
  });
});

describe("content validation rejects what is not media", () => {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
  ]);

  it("recognises the formats the catalogue actually emits", () => {
    expect(sniffGeneratedMime(png)).toBe("image/png");
    expect(
      sniffGeneratedMime(
        Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom")]),
      ),
    ).toBe("video/mp4");
    expect(
      sniffGeneratedMime(
        Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]),
      ),
    ).toBe("video/webm");
    expect(
      sniffGeneratedMime(
        Buffer.from("ID3\x04\x00\x00\x00\x00\x00\x00\x00\x00"),
      ),
    ).toBe("audio/mpeg");
  });

  it("rejects an HTML error page served as an image", () => {
    /**
     * The reason bytes are checked rather than headers. A provider CDN
     * returning `<!DOCTYPE html>` with a 200 and `content-type: image/png`
     * would otherwise be stored under a `.png` key in a **public** bucket —
     * stored XSS on our own storage origin, delivered to whoever opens the
     * asset.
     */
    expect(
      sniffGeneratedMime(Buffer.from("<!DOCTYPE html><html>oops")),
    ).toBeNull();
  });

  it("rejects a truncated file too short to identify", () => {
    expect(sniffGeneratedMime(Buffer.from([0x89, 0x50]))).toBeNull();
  });

  it("does not accept a file on its claimed type alone", () => {
    // Same bytes, whatever the header said. There is no argument to this
    // function that a caller could use to assert a type.
    expect(sniffGeneratedMime(Buffer.from("just some text at all"))).toBeNull();
  });
});

describe("one delivery path, and it is idempotent", () => {
  const read = (path: string) =>
    readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");

  it("routes the worker and the client through the same function", () => {
    /**
     * The worker used to call `markSucceeded`, which flipped a status and
     * stored nothing — a generation could report success with no asset, no R2
     * object and no cost. Two delivery implementations is how the two paths
     * came to mean different things by "succeeded".
     *
     * Both now call `settleSuccess`. Asserted on the source because the
     * alternative — importing the worker — pulls in `server-only` and a Prisma
     * client bound to production.
     */
    const worker = read("services/worker/runner.ts");
    expect(worker).toMatch(/settleSuccess\(/);
    // Nothing in the worker may create an asset row on its own.
    expect(worker).not.toMatch(/asset\.create|storeGeneratedAsset/);

    const service = read("services/generation.ts");
    // Both call sites in the client-driven path use the same function.
    expect(service.match(/await settleSuccess\(/g)?.length).toBeGreaterThan(1);
  });

  it("derives the same storage key for the same bytes", () => {
    // A retry after a crashed transaction must overwrite, not duplicate.
    const args = {
      userId: "u1",
      generationId: "g1",
      index: 0,
      checksum: "a".repeat(64),
      mimeType: "image/png",
    };
    expect(generatedStorageKey(args)).toBe(generatedStorageKey(args));
    expect(generatedStorageKey(args)).toMatch(
      /^users\/u1\/generations\/g1\/0-a{32}\.png$/,
    );
  });

  it("separates outputs of one generation, and different content", () => {
    const base = {
      userId: "u1",
      generationId: "g1",
      index: 0,
      checksum: "a".repeat(64),
      mimeType: "image/png",
    };
    // Two images from one batch must not collide...
    expect(generatedStorageKey({ ...base, index: 1 })).not.toBe(
      generatedStorageKey(base),
    );
    // ...and a regenerated, different image is a different object.
    expect(generatedStorageKey({ ...base, checksum: "b".repeat(64) })).not.toBe(
      generatedStorageKey(base),
    );
  });

  it("runs the audio gate before the asset transaction, not after", () => {
    /**
     * Ordering is the whole guarantee.
     *
     * The asset transaction is the point of no return: it creates the rows the
     * library reads and flips the generation to SUCCEEDED. A gate that ran
     * after it would be judging a video the customer can already see, and
     * refunding a generation that had already been delivered.
     *
     * Asserted on the source for the same reason as the test above — importing
     * `generation.ts` pulls in `server-only` and a Prisma client bound to
     * production.
     */
    const service = read("services/generation.ts");
    const settle = service.slice(
      service.indexOf("export async function settleSuccess"),
    );

    const gate = settle.indexOf("checkDeliveredAudio");
    const transaction = settle.indexOf('inStage("asset_transaction"');

    expect(gate).toBeGreaterThan(-1);
    expect(transaction).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(transaction);
  });

  it("refunds and throws when the gate refuses", () => {
    // Fail closed. A promised-audio generation that arrives silent must not be
    // billed, and must not fall through to delivery on the strength of a
    // logged warning.
    const service = read("services/generation.ts");
    const settle = service.slice(
      service.indexOf("export async function settleSuccess"),
    );

    expect(settle).toMatch(
      /settleFailedDelivery\(\{[\s\S]{0,200}AUDIO_PROMISED_BUT_ABSENT/,
    );
    expect(settle).toMatch(/throw new GenerationError\(/);
  });

  it("guards asset creation on the storage key before inserting", () => {
    // The idempotency that stops a redelivery showing the customer their image
    // twice. Paired with the deterministic key above: same bytes, same key,
    // found, skipped.
    const service = read("services/generation.ts");
    const settle = service.slice(
      service.indexOf("export async function settleSuccess"),
    );
    expect(settle).toMatch(/findFirst\(\{[\s\S]{0,120}storageKey/);
    expect(settle).toMatch(/if \(existing\) continue;/);
  });
});
