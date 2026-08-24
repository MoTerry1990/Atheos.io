import { describe, expect, it } from "vitest";

import {
  ImageCapabilityConflictError,
  compileImageForModel,
} from "@/services/ai/compile-image";
import { confirmImageField } from "@/services/ai/image-brief";
import { findImageModel } from "@/services/ai/image-capabilities";
import { planImageFromPrompt } from "@/services/ai/image-planner";

/**
 * What each provider actually receives.
 *
 * ## The prompt this replaces
 *
 * The audited benchmark generation (`cmt6cqxlb…snbmi8`) submitted:
 *
 *   a red dragon on a castle throwing fire from its mouth, cinematic lighting,
 *   anamorphic, shallow depth of field, film grain, high-contrast monochrome,
 *   hard shadows, single-source light, cinematic lighting, anamorphic, shallow
 *   depth of field, film grain, high contrast monochrome, hard shadows,
 *   single source light
 *
 * The style block appears twice, and it orders **monochrome** for a subject the
 * user described as **red**. That string was built by concatenation in the
 * browser, so nothing was in a position to notice either problem.
 *
 * These tests assert the properties that make it unrepeatable: the compiler
 * builds from fields, so a style can only arrive through a field; and no field
 * is emitted twice.
 */

const DRAGON = "a red dragon on a castle throwing fire from its mouth";
const SMART = findImageModel("replicate/nano-banana-2")!;
const DRAFT = findImageModel("replicate/flux-schnell")!;
const PRO = findImageModel("replicate/nano-banana-pro")!;
const STUDIO = findImageModel("replicate/flux-2-pro")!;

function brief() {
  return planImageFromPrompt({ prompt: DRAGON });
}

describe("the corrupted-prompt class cannot recur", () => {
  it("never contradicts a stated colour", () => {
    const compiled = compileImageForModel({ brief: brief(), model: SMART });
    expect(compiled.prompt).toMatch(/red/i);
    expect(compiled.prompt).not.toMatch(
      /monochrome|black and white|greyscale|grayscale/i,
    );
  });

  it("emits no duplicated style block", () => {
    const compiled = compileImageForModel({ brief: brief(), model: SMART });
    const lines = compiled.prompt
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("says each craft term at most once", () => {
    const compiled = compileImageForModel({ brief: brief(), model: SMART });
    for (const term of ["Lighting:", "Colour:", "Composition:", "Style:"]) {
      const count = compiled.prompt.split(term).length - 1;
      expect(count).toBeLessThanOrEqual(1);
    }
  });
});

describe("6. Nano Banana receives the correct provider input", () => {
  const compiled = compileImageForModel({ brief: brief(), model: SMART });

  it("passes the confirmed aspect ratio", () => {
    expect(compiled.parameters.aspect_ratio).toBe("16:9");
  });

  it("4. asks for native 2K", () => {
    expect(compiled.parameters.resolution).toBe("2K");
  });

  it("sends no parameter the schema does not have", () => {
    /**
     * The schema's inputs are exactly: prompt, image_input, aspect_ratio,
     * resolution, output_format, google_search, image_search. Sending anything
     * else is a rejected job on a model that has already reserved credits —
     * which is how Motion 1 used to fail with `image` attached.
     */
    const allowed = new Set([
      "aspect_ratio",
      "resolution",
      "output_format",
      "image_input",
      "google_search",
      "image_search",
    ]);
    for (const key of Object.keys(compiled.parameters)) {
      expect(allowed.has(key)).toBe(true);
    }
  });

  it("sends no negative prompt, because there is no such input", () => {
    expect(compiled.negativePrompt).toBe("");
    expect(compiled.parameters.negative_prompt).toBeUndefined();
  });

  it("sends no thinking level, because the schema has none", () => {
    // The model is marketed as reasoning; Replicate exposes no such parameter.
    expect(compiled.parameters.thinking_level).toBeUndefined();
    expect(SMART.interpretsShortPrompts).toBe(true);
  });

  it("keeps the dragon on the castle as an instruction", () => {
    expect(compiled.prompt).toMatch(/physically on .*castle/i);
    expect(compiled.prompt).toMatch(/not beside it/i);
  });

  it("makes the fire light the scene", () => {
    expect(compiled.prompt).toMatch(/firelight/i);
  });
});

describe("5. Draft Image stays 1K and says so", () => {
  const compiled = compileImageForModel({ brief: brief(), model: DRAFT });

  it("does not claim a resolution it cannot render", () => {
    expect(compiled.parameters.resolution).toBeUndefined();
    expect(compiled.parameters.megapixels).toBe("1");
  });

  it("reports the 2K request as dropped rather than silently downgrading", () => {
    expect(compiled.omitted.join(" ")).toMatch(/2K/);
    expect(compiled.omitted.join(" ")).toMatch(/one megapixel/i);
  });

  it("still carries the spatial relationship, in FLUX's own idiom", () => {
    // Comma-weighted rather than instructional — a real difference per model.
    expect(compiled.prompt).toMatch(/on a castle/i);
    expect(compiled.prompt).not.toContain("\n");
  });
});

describe("references are checked against the schema", () => {
  it("passes references to Smart Image as image_input", () => {
    const withRefs = planImageFromPrompt({
      prompt: DRAGON,
      referenceImageCount: 2,
    });
    const compiled = compileImageForModel({
      brief: withRefs,
      model: SMART,
      referenceUrls: [
        "https://storage.example/a.png",
        "https://storage.example/b.png",
      ],
    });
    expect(compiled.parameters.image_input).toHaveLength(2);
    expect(compiled.prompt).toMatch(/identical/i);
  });

  it("11-style refusal: a model with no image input rejects an identity brief", () => {
    const withRefs = planImageFromPrompt({
      prompt: DRAGON,
      referenceImageCount: 1,
    });
    expect(() =>
      compileImageForModel({
        brief: withRefs,
        model: DRAFT,
        referenceUrls: ["https://storage.example/a.png"],
      }),
    ).toThrow(ImageCapabilityConflictError);
  });

  it("warns that Draft Plus starts from a reference rather than holding identity", () => {
    const withRefs = confirmImageField(
      planImageFromPrompt({ prompt: DRAGON, referenceImageCount: 1 }),
      "references",
      { count: 1, use: "visual_guidance" },
    );
    const compiled = compileImageForModel({
      brief: withRefs,
      model: findImageModel("replicate/flux-dev")!,
      referenceUrls: ["https://storage.example/a.png"],
    });
    expect(compiled.omitted.join(" ")).toMatch(/does not hold a character/i);
  });

  it("caps references at what the model accepts", () => {
    const many = Array.from({ length: 20 }, (_, i) => `https://s/${i}.png`);
    const compiled = compileImageForModel({
      brief: planImageFromPrompt({ prompt: DRAGON, referenceImageCount: 20 }),
      model: PRO,
      referenceUrls: many,
    });
    expect((compiled.parameters.image_input as string[]).length).toBe(14);
    expect(compiled.omitted.join(" ")).toMatch(/6 reference image/);
  });
});

describe("7. a model that is not sold cannot be compiled for", () => {
  it("refuses Studio Image, whose cost depends on customer-supplied inputs", () => {
    expect(STUDIO.enabled).toBe(false);
    expect(() =>
      compileImageForModel({ brief: brief(), model: STUDIO }),
    ).toThrow(/not available/i);
  });
});

describe("exclusions go into the prompt, since no model takes them separately", () => {
  it("states them as prose", () => {
    const b = planImageFromPrompt({
      prompt: `${DRAGON}, no people`,
    });
    const compiled = compileImageForModel({ brief: b, model: SMART });
    expect(compiled.prompt).toMatch(/Do not include:.*people/i);
    expect(compiled.negativePrompt).toBe("");
  });
});
