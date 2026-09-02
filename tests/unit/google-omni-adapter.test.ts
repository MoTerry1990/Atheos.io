import { describe, expect, it } from "vitest";

import {
  jobFromInteraction,
  pollDelayMs,
  POLL_LIMITS,
  OMNI_MODEL_ID,
  OMNI_SELLABLE_RESOLUTION,
  OMNI_DURATION_RANGE,
  OMNI_DURATION_MODE,
  type InteractionLike,
} from "@/services/ai/providers/google-omni";

/**
 * The adapter's response handling, driven by fixtures. No network, ever.
 *
 * ## Why fixtures rather than a mocked client
 *
 * A mocked SDK proves the adapter calls the functions the mock defines, which
 * is a tautology. What matters is what the adapter does with a *payload* —
 * inline versus URI delivery, completed versus failed, a success with nothing
 * in it — and those are the same object whether they arrive through the SDK or
 * through raw REST. `jobFromInteraction` is exported precisely so both can be
 * driven from one function and this file can prove they agree.
 *
 * ## Statuses are the SDK's, not invented ones
 *
 * `InteractionStatus` is `in_progress | requires_action | completed | failed |
 * cancelled | incomplete | budget_exceeded | queued`. It is deliberately *not*
 * `FileState`'s `ACTIVE`/`FAILED` — that enum describes uploaded files, and an
 * earlier draft of this adapter was built on exactly that kind of guess.
 */

const base = (over: Partial<InteractionLike> = {}): InteractionLike => ({
  id: "interactions/abc123",
  status: "completed",
  ...over,
});

describe("the audited contract, pinned", () => {
  it("names the stable model id and not the preview alias", () => {
    // Changing this is a licence decision, not a version bump.
    expect(OMNI_MODEL_ID).toBe("gemini-omni-1.1-flash");
    expect(OMNI_MODEL_ID).not.toMatch(/preview/);
  });

  it("sells one resolution, because one is all that is priced", () => {
    expect(OMNI_SELLABLE_RESOLUTION).toBe("720p");
  });

  it("declares duration as the model's decision, over a range", () => {
    /**
     * The correction that matters commercially. Publishing an enum of exact
     * lengths the documentation does not promise would put "10 seconds" on a
     * quote and deliver whatever came back.
     */
    expect(OMNI_DURATION_MODE).toBe("model_decided");
    expect(OMNI_DURATION_RANGE).toEqual({ min: 3, max: 10 });
  });
});

describe("delivery by URI — the mode the adapter asks for", () => {
  it("passes the URI through for the pipeline to fetch", () => {
    const job = jobFromInteraction(
      base({
        output_video: {
          uri: "https://generativelanguage.example/files/xyz",
          mime_type: "video/mp4",
        },
      }),
    );

    expect(job.state).toBe("succeeded");
    expect(job.outputs).toEqual([
      {
        sourceUrl: "https://generativelanguage.example/files/xyz",
        mimeType: "video/mp4",
      },
    ]);
  });

  it("defaults the mime type rather than leaving it undefined", () => {
    const job = jobFromInteraction(
      base({ output_video: { uri: "https://example.test/a" } }),
    );

    expect(job.outputs?.[0]?.mimeType).toBe("video/mp4");
  });
});

describe("delivery inline — accepted even though it is not requested", () => {
  it("wraps base64 as a data URI so storage keeps one code path", () => {
    /**
     * `delivery: "uri"` is what the adapter asks for, because a ten-second
     * clip as base64 in a JSON body is tens of megabytes through the parser.
     * The API may still answer inline for a short one, and a data URI means
     * `storeGeneratedAsset` fetches it exactly as it fetches anything else —
     * writing the bytes verbatim, which is what preserves SynthID and C2PA.
     */
    const job = jobFromInteraction(
      base({
        output_video: { data: "AAAAIGZ0eXBpc29t", mime_type: "video/mp4" },
      }),
    );

    expect(job.state).toBe("succeeded");
    expect(job.outputs?.[0]?.sourceUrl).toBe(
      "data:video/mp4;base64,AAAAIGZ0eXBpc29t",
    );
  });

  it("prefers the URI when a payload somehow carries both", () => {
    const job = jobFromInteraction(
      base({
        output_video: {
          uri: "https://example.test/a",
          data: "AAAA",
          mime_type: "video/mp4",
        },
      }),
    );

    expect(job.outputs?.[0]?.sourceUrl).toBe("https://example.test/a");
  });
});

describe("states that are not yet an answer", () => {
  it.each(["queued", "in_progress", "requires_action"])(
    "keeps polling on %s",
    (status) => {
      const job = jobFromInteraction(base({ status, output_video: undefined }));

      expect(job.state).toBe("running");
      expect(job.providerJobId).toBe("interactions/abc123");
      expect(job.outputs).toBeUndefined();
    },
  );
});

describe("states that are a failure", () => {
  it.each(["failed", "cancelled", "incomplete", "budget_exceeded"])(
    "throws a sanitised error on %s",
    (status) => {
      /**
       * The vendor's diagnostics are attached to `raw` for the log and never
       * reach the message: they can name the model, the project and the quota
       * that was hit.
       */
      expect(() =>
        jobFromInteraction(
          base({ status, errors: [{ message: "quota exceeded for project" }] }),
        ),
      ).toThrowError();

      try {
        jobFromInteraction(base({ status, errors: [{ message: "secret" }] }));
      } catch (error) {
        const failure = error as { message: string; code: string };
        expect(failure.message).toBe("The generation failed.");
        expect(failure.message).not.toMatch(/quota|project|google|gemini/i);
      }
    },
  );

  it("refuses a completed interaction with no video in it", () => {
    // "Succeeded with nothing" must not become a generation with no output.
    expect(() =>
      jobFromInteraction(base({ output_video: undefined })),
    ).toThrow();
    expect(() =>
      jobFromInteraction(base({ output_video: { mime_type: "video/mp4" } })),
    ).toThrow();
  });
});

describe("one function serves the SDK object and the REST payload", () => {
  it("produces the same job from both shapes", () => {
    /**
     * The SDK returns a typed object; a raw REST call returns parsed JSON of
     * the same shape. Asserting they agree is what lets the adapter have one
     * code path instead of two that drift.
     */
    const fromSdk = jobFromInteraction({
      id: "interactions/abc123",
      status: "completed",
      output_video: { uri: "https://example.test/a", mime_type: "video/mp4" },
    });

    const fromRest = jobFromInteraction(
      JSON.parse(
        JSON.stringify({
          id: "interactions/abc123",
          status: "completed",
          output_video: {
            uri: "https://example.test/a",
            mime_type: "video/mp4",
          },
        }),
      ) as InteractionLike,
    );

    expect(fromRest).toEqual(fromSdk);
  });
});

describe("polling is bounded", () => {
  it("backs off exponentially and stops growing", () => {
    expect(pollDelayMs(0)).toBe(2_000);
    expect(pollDelayMs(1)).toBe(4_000);
    expect(pollDelayMs(2)).toBe(8_000);
    // Capped, so a long job does not end up polling once an hour.
    expect(pollDelayMs(10)).toBe(POLL_LIMITS.maxDelayMs);
  });

  it("has a ceiling on attempts and on total time", () => {
    // A vendor that never finishes must not hold a job open forever.
    expect(POLL_LIMITS.maxAttempts).toBeGreaterThan(0);
    expect(POLL_LIMITS.totalTimeoutMs).toBeGreaterThan(0);
    expect(POLL_LIMITS.totalTimeoutMs).toBeLessThanOrEqual(15 * 60 * 1000);
  });
});

describe("the request never carries an invented audio switch", () => {
  it("has no audio parameter anywhere in the adapter", async () => {
    /**
     * The documented `VideoResponseFormat` has no audio field and the model
     * "natively generates audio with every video output". A `generateAudio:
     * false` here would be a switch wired to nothing: the customer picks
     * Silent, is charged for it, and receives sound.
     *
     * Asserted against the source because the failure is an *addition* — the
     * next person to wire a Silent control reaches for exactly this.
     */
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");

    const source = readFileSync(
      resolve(
        import.meta.dirname,
        "../../services/ai/providers/google-omni.ts",
      ),
      "utf8",
    );

    // Only the explanatory comments may name it; no assignment may exist.
    expect(source).not.toMatch(/generateAudio\s*:/);
    expect(source).not.toMatch(/generate_audio\s*:/);
    expect(source).not.toMatch(/\baudio\s*:\s*(false|true)/);
    // And retention stays off.
    expect(source).toMatch(/store:\s*false/);
    // And the delivery mode is the one the header argues for.
    expect(source).toMatch(/delivery:\s*"uri"/);
  });
});
