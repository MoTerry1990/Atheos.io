import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { SHOWCASE } from "@/features/marketing/content";
import { publicModels } from "@/features/marketing/lib/public-models";
import {
  isOfferedToOwner,
  isPubliclyOffered,
  policyFor,
} from "@/services/ai/model-policy";
import { isModelEnabled } from "@/services/billing/model-costs";
import {
  SHOWCASE_SOURCE_MODELS,
  isPublishable,
} from "@/services/marketing/publication-policy";

/**
 * The AudioGen containment, asserted end to end.
 *
 * ## The incident
 *
 * `replicate/sfx` was an internal alias. The registry described it as
 * `zsxkib/mmaudio` at version `62871fb5`, licensed MIT, `ALLOWED_PUBLIC`. The
 * adapter had never called that model: it pins
 * `154b3e5141493cb1b8cec976d9aa90f2b691137e39ad906d2421b74c2a8c52b8`, which
 * resolves to `sepal/audiogen` — Meta's AudioGen, whose weights carry the same
 * CC-BY-NC 4.0 `LICENSE_weights` this registry already cites to block Score.
 *
 * So a non-commercial model was priced, offered, generated from, and its output
 * published on a commercial marketing page. This file is the regression suite
 * for every surface that was wrong, in the order a request travels through
 * them: policy, cost, discovery, publication, bytes.
 *
 * ## Why so many small assertions
 *
 * Because each one was a separate place the model had to be removed from, and
 * a single "is it blocked" check would pass while any of the others still
 * offered it. The version-versus-adapter check that would have caught the
 * original drift lives in `model-policy.test.ts`, next to the registry.
 */

const AUDIOGEN = "replicate/sfx";
const ROOT = resolve(import.meta.dirname, "..", "..");

describe("the registry tells the truth about AudioGen", () => {
  it("names the model the adapter actually calls", () => {
    const policy = policyFor(AUDIOGEN)!;

    expect(policy.hostedEndpoint).toBe("replicate:sepal/audiogen");
    expect(policy.auditedVersion).toBe("154b3e51");
    expect(policy.licence).toContain("CC-BY-NC-4.0");
  });

  it("blocks it for everyone, owner included", () => {
    const policy = policyFor(AUDIOGEN)!;

    expect(policy.status).toBe("BLOCKED_COMMERCIAL");
    expect(policy.permittedAudience).toBe("nobody");
    expect(policy.permittedProvider).toBe("none");
    expect(policy.commercialOutput).toBe("denied");

    // The two questions every gate in the codebase asks.
    expect(isPubliclyOffered(AUDIOGEN)).toBe(false);
    expect(isOfferedToOwner(AUDIOGEN)).toBe(false);
  });

  it("cites the licence file rather than asserting the licence", () => {
    /**
     * The original entry claimed MIT with no evidence URL that could have
     * contradicted it. A reader must be able to check this one in a browser.
     */
    const policy = policyFor(AUDIOGEN)!;

    expect(policy.evidenceUrls).toContain(
      "https://github.com/facebookresearch/audiocraft/blob/main/LICENSE_weights",
    );
    expect(policy.evidenceUrls).toContain(
      "https://replicate.com/sepal/audiogen",
    );
  });
});

describe("nothing downstream can charge for it or offer it", () => {
  it("is disabled in the cost table, so it cannot be quoted", () => {
    // `isModelEnabled` gates pricing and quotation. A priced model is a
    // model a quote can be issued for.
    expect(isModelEnabled(AUDIOGEN)).toBe(false);
  });

  it("is absent from the public models page", () => {
    // `publicModels()` derives from the registry and the cost table rather
    // than keeping its own list, so this is a check that the derivation ran —
    // and that no hand-written editorial entry survived it.
    expect(publicModels().map((model) => model.id)).not.toContain(AUDIOGEN);
    expect(publicModels().map((model) => model.modality)).not.toContain(
      "AUDIO",
    );
  });

  it("cannot be published, whatever asks", () => {
    expect(isPublishable(AUDIOGEN)).toBe(false);
  });
});

describe("the public marketing surface makes no audio claim", () => {
  it("has no showcase tab and no showcase provenance entry", () => {
    expect(SHOWCASE.map((tab) => tab.id)).not.toContain("audio");
    expect(Object.keys(SHOWCASE_SOURCE_MODELS)).not.toContain("audio");
  });

  it("ships no audio file in the public directory at all", () => {
    /**
     * Belt and braces against a stray asset: the containment removed named
     * files, and this walks the tree so a differently named copy cannot come
     * back unnoticed.
     */
    const offences: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = resolve(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (/\.(m4a|mp3|wav|ogg|aac|flac|opus)$/i.test(entry)) {
          offences.push(path.slice(ROOT.length + 1));
        }
      }
    };

    walk(resolve(ROOT, "public"));
    expect(offences).toEqual([]);
  });

  it("ships no showcase video carrying an audio track", () => {
    /**
     * `mp4a` is the AAC sample-entry box. Its presence in an MP4 is what
     * "there is a soundtrack in this file" looks like from the bytes, and the
     * bytes are the only thing a visitor actually receives.
     *
     * Scoped to the showcase because that is what this containment covers.
     * `public/marketing/hero.c7da9646fe.mp4` also carries an AAC track and is
     * **not** AudioGen — it came with a Google-generated master, and its
     * source model is not recorded anywhere in `docs/MEDIA-PROVENANCE.md`.
     * That is a separate finding, raised for the full publication audit rather
     * than quietly folded into this fix; widening the assertion here would
     * make this file fail for a reason it does not describe.
     */
    const offences: string[] = [];
    const dir = resolve(ROOT, "public", "marketing", "showcase");

    const walk = (at: string) => {
      for (const entry of readdirSync(at)) {
        const path = resolve(at, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.(mp4|webm|mov)$/i.test(entry)) continue;
        if (readFileSync(path).includes(Buffer.from("mp4a"))) {
          offences.push(path.slice(ROOT.length + 1));
        }
      }
    };

    walk(dir);
    expect(offences).toEqual([]);
  });
});
