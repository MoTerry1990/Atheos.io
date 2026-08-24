import { describe, expect, it } from "vitest";

import { MODEL_CAPABILITIES, assessModel } from "@/services/ai/brief-routing";
import { confirmField } from "@/services/ai/creative-brief";
import { confirmImageField } from "@/services/ai/image-brief";
import {
  IMAGE_MODEL_CAPABILITIES,
  creditsForImage,
  findImageModel,
  providerCostMicroUsd,
} from "@/services/ai/image-capabilities";
import { planImageFromPrompt } from "@/services/ai/image-planner";
import {
  assessImageModel,
  recommendImageModels,
} from "@/services/ai/image-routing";
import { planFromPrompt } from "@/services/ai/intent-planner";

/**
 * Which model, at what price, and what it will refuse.
 *
 * ## The two failures this covers
 *
 * A 1024x1024 square was returned for a cinematic wide, because nothing
 * compared the brief against what `flux-dev` can render. And a video request
 * carrying a reference image went to `wan-2.2-t2v-fast`, whose schema has no
 * image field at all — so "animate this picture" produced an unrelated clip.
 *
 * Both were knowable from the schema before a credit moved.
 */

const DRAGON = "a red dragon on a castle throwing fire from its mouth";

/** $0.005 per credit. The rate `services/billing/model-costs.ts` derives. */
const CREDIT_VALUE_MICRO_USD = 5_000;

describe("13. every enabled image model clears its margin floor", () => {
  for (const model of IMAGE_MODEL_CAPABILITIES.filter((m) => m.enabled)) {
    for (const resolution of model.resolutions) {
      it(`${model.label} at ${resolution}`, () => {
        const credits = creditsForImage(model, resolution);
        const cost = providerCostMicroUsd(model, resolution);
        expect(credits).not.toBeNull();
        expect(cost).not.toBeNull();

        const revenue = credits! * CREDIT_VALUE_MICRO_USD;
        // 2.5x is the image floor in the cost doctrine.
        expect(revenue / cost!).toBeGreaterThanOrEqual(2.5);
      });
    }
  }

  it("a disabled model has no price at all", () => {
    // Not a zero price — no price. An unknown cost cannot be sold.
    const studio = findImageModel("replicate/flux-2-pro")!;
    expect(studio.enabled).toBe(false);
    expect(creditsForImage(studio, "2K")).toBeNull();
  });
});

describe("4-5. the benchmark brief routes to Smart Image at 2K", () => {
  const brief = planImageFromPrompt({ prompt: DRAGON });
  const recommendation = recommendImageModels(brief);

  it("recommends Smart Image", () => {
    expect(recommendation.recommended?.model.label).toBe("Smart Image");
    expect(recommendation.recommended?.effectiveResolution).toBe("2K");
  });

  it("quotes 55 credits, from the audited 2K price", () => {
    // $0.101 x 2.72 at $0.005/credit.
    expect(recommendation.recommended?.credits).toBe(55);
  });

  it("offers Draft Image, honestly labelled as smaller", () => {
    const draft = recommendation.verdicts.find(
      (v) => v.model.label === "Draft Image",
    )!;
    expect(draft.compatibility).toBe("partial");
    expect(draft.caveats.join(" ")).toMatch(/1024/);
    expect(draft.credits).toBe(4);
  });

  it("does not recommend the most expensive capable model", () => {
    /**
     * Pro Image can also make this. Defaulting to it would be a pricing
     * decision dressed as a recommendation — the user asked for a picture, not
     * to spend 80 credits.
     */
    expect(recommendation.recommended?.model.label).not.toBe("Pro Image");
  });
});

describe("a chosen resolution is a requirement, a defaulted one is not", () => {
  it("blocks Draft Image when the user actually asked for 4K", () => {
    const brief = confirmImageField(
      planImageFromPrompt({ prompt: DRAGON }),
      "resolution",
      "4K",
    );
    const verdict = assessImageModel(
      brief,
      findImageModel("replicate/flux-schnell")!,
    );
    expect(verdict.compatibility).toBe("incompatible");
    expect(verdict.conflicts.join(" ")).toMatch(/you asked for 4K/);
  });

  it("only warns when 2K was merely the default", () => {
    // Otherwise the cheap tier becomes unreachable for everyone.
    const brief = planImageFromPrompt({ prompt: DRAGON });
    expect(brief.resolution.from).toBe("default");
    const verdict = assessImageModel(
      brief,
      findImageModel("replicate/flux-schnell")!,
    );
    expect(verdict.compatibility).toBe("partial");
  });
});

describe("references decide which models are possible", () => {
  it("blocks a model with no image input", () => {
    const brief = planImageFromPrompt({
      prompt: DRAGON,
      referenceImageCount: 1,
    });
    const verdict = assessImageModel(
      brief,
      findImageModel("replicate/flux-schnell")!,
    );
    expect(verdict.compatibility).toBe("incompatible");
    expect(verdict.conflicts.join(" ")).toMatch(/would draw a new picture/i);
  });

  it("blocks a model that cannot hold identity when identity was asked for", () => {
    const brief = planImageFromPrompt({
      prompt: DRAGON,
      referenceImageCount: 1,
    });
    expect(brief.references.value.use).toBe("preserve_exactly");
    const verdict = assessImageModel(
      brief,
      findImageModel("replicate/flux-dev")!,
    );
    expect(verdict.compatibility).toBe("incompatible");
    expect(verdict.conflicts.join(" ")).toMatch(
      /cannot keep your subject identical/i,
    );
  });

  it("routes a reference brief to Smart Image", () => {
    const brief = planImageFromPrompt({
      prompt: DRAGON,
      referenceImageCount: 1,
    });
    const recommendation = recommendImageModels(brief);
    expect(recommendation.recommended?.model.preservesSubjectIdentity).toBe(
      true,
    );
  });
});

describe("11-12. the video side refuses what it cannot do", () => {
  const motion1 = MODEL_CAPABILITIES.find(
    (m) => m.id === "replicate/video-gen",
  )!;

  it("Motion 1 rejects reference-image animation", () => {
    /**
     * The exact request behind the benchmark clip. `wan-2.2-t2v-fast` has no
     * `image` input, so the only honest answer is no.
     */
    let brief = planFromPrompt({
      prompt: "animate this picture of a dragon for 5 seconds",
      referenceImageCount: 1,
    });
    brief = confirmField(brief, "audioStrategy", "SILENT");
    const verdict = assessModel(brief, motion1);
    expect(verdict.compatibility).toBe("incompatible");
    expect(verdict.conflicts.join(" ")).toMatch(/reference|image/i);
  });

  it("Motion 1 rejects promised audio", () => {
    const brief = planFromPrompt({
      prompt: "a 5 second clip of a dragon with sound",
    });
    expect(brief.audioStrategy.value).not.toBe("SILENT");
    const verdict = assessModel(brief, motion1);
    expect(verdict.conflicts.join(" ")).toMatch(/audio|sound/i);
  });

  it("recommends something that can, rather than nothing", () => {
    const brief = planFromPrompt({
      prompt: "animate this picture of a dragon with sound",
      referenceImageCount: 1,
    });
    const capable = MODEL_CAPABILITIES.filter(
      (m) => assessModel(brief, m).compatibility !== "incompatible",
    );
    expect(capable.length).toBeGreaterThan(0);
    for (const model of capable) {
      expect(model.acceptsImageInput).toBe(true);
    }
  });
});
