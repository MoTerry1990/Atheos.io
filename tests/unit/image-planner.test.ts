import { describe, expect, it } from "vitest";

import { imageAssumptionsIn } from "@/services/ai/image-brief";
import {
  imageClarificationsFor,
  planImageFromPrompt,
} from "@/services/ai/image-planner";

/**
 * Short-prompt intelligence, against the fixed benchmark set.
 *
 * ## What the benchmark proved
 *
 * `a red dragon on a castle throwing fire from its mouth` went to the provider
 * as eleven words plus two contradictory style blocks, at 1:1, and came back as
 * a square picture of a dragon *beside* a castle. The words "on a castle" were
 * in the prompt the whole time. Nothing read them, because nothing had a field
 * for a spatial relationship.
 *
 * These tests are the floor: what Atheos must understand from a short prompt
 * without the customer learning to write like a prompt engineer.
 */

const DRAGON = "a red dragon on a castle throwing fire from its mouth";

describe("1. the benchmark prompt", () => {
  const brief = planImageFromPrompt({ prompt: DRAGON });

  it("reads the subject and its colour", () => {
    expect(brief.primarySubject.value).toMatch(/dragon/i);
    expect(brief.subjectAttributes.value).toContain("red");
    // Read from the prompt, so the panel must not offer to "confirm" it.
    expect(brief.primarySubject.from).toBe("explicit");
  });

  it("reads the action", () => {
    expect(brief.action.value).toMatch(/throwing fire/i);
    expect(brief.action.from).toBe("explicit");
  });

  it("keeps the dragon ON the castle", () => {
    /**
     * The single most important assertion in this file. "on a castle" is a
     * physical relationship, and a model handed a bag of nouns puts them side
     * by side — which is exactly what the benchmark image shows.
     */
    expect(brief.spatialRelationships.value).toHaveLength(1);
    expect(brief.spatialRelationships.value[0]).toMatch(/^on\b.*castle/i);
    expect(brief.spatialRelationships.from).toBe("explicit");
  });

  it("reads the castle as the setting and the background", () => {
    expect(brief.setting.value).toMatch(/castle/i);
    expect(brief.background.value).toMatch(/castle/i);
  });

  it("infers a wide frame rather than defaulting to square", () => {
    // The benchmark's actual defect, as a test.
    expect(brief.aspectRatio.value).toBe("16:9");
    expect(brief.aspectRatio.from).toBe("inferred");
    expect(brief.aspectRatio.because).toBeTruthy();
  });

  it("asks for 2K, not the provider's 1K default", () => {
    expect(brief.resolution.value).toBe("2K");
  });

  it("makes the fire light the scene", () => {
    // "throwing fire" is a light source, not just an object.
    expect(brief.lighting.value).toMatch(/firelight/i);
    expect(brief.lighting.value).toMatch(/falling on/i);
  });

  it("marks every guess as a guess", () => {
    const assumed = imageAssumptionsIn(brief).map((a) => a.field);
    expect(assumed).toContain("aspectRatio");
    // And each one carries a reason a person can read.
    for (const a of imageAssumptionsIn(brief)) {
      expect(a.because.length).toBeGreaterThan(8);
    }
  });
});

describe("2. explicit user detail beats inference", () => {
  it("a stated ratio wins over the cinematic inference", () => {
    const brief = planImageFromPrompt({
      prompt: "a cinematic red dragon on a castle, 1:1",
    });
    expect(brief.aspectRatio.value).toBe("1:1");
    expect(brief.aspectRatio.from).toBe("explicit");
  });

  it("a composer control wins over both", () => {
    const brief = planImageFromPrompt({
      prompt: "a cinematic red dragon on a castle",
      controls: { aspectRatio: "9:16", resolution: "4K" },
    });
    expect(brief.aspectRatio.value).toBe("9:16");
    expect(brief.aspectRatio.from).toBe("explicit");
    expect(brief.resolution.value).toBe("4K");
  });

  it("an explicitly illustrated look is not overridden by 'cinematic'", () => {
    const brief = planImageFromPrompt({
      prompt: "a cinematic illustration of a dragon",
    });
    expect(brief.realism.value).toBe("illustrated");
    expect(brief.realism.from).toBe("explicit");
  });
});

describe("3. cinematic scenes recommend 16:9", () => {
  for (const prompt of [
    "a cinematic shot of a lighthouse",
    "epic dragon over the mountains",
    "a wide landscape of a desert city",
    "una escena cinematográfica de un castillo",
  ]) {
    it(`"${prompt}" → 16:9`, () => {
      expect(planImageFromPrompt({ prompt }).aspectRatio.value).toBe("16:9");
    });
  }

  it("a vertical request is not overridden", () => {
    expect(
      planImageFromPrompt({ prompt: "a cinematic dragon, vertical for a reel" })
        .aspectRatio.value,
    ).toBe("9:16");
  });
});

describe("25. Spanish, typos and informal phrasing", () => {
  it("reads a Spanish spatial relationship", () => {
    const brief = planImageFromPrompt({
      prompt: "un dragón rojo sobre un castillo lanzando fuego",
    });
    expect(brief.spatialRelationships.value[0]).toMatch(/sobre .*castillo/i);
    expect(brief.subjectAttributes.value).toContain("rojo");
    expect(brief.action.value).toMatch(/lanzando fuego/i);
  });

  it("reads a Spanish car prompt", () => {
    const brief = planImageFromPrompt({
      prompt: "un carro rojo conduciendo cerca del oceano",
    });
    expect(brief.primarySubject.value).toMatch(/carro/i);
    expect(brief.subjectAttributes.value).toContain("rojo");
  });

  it("survives missing accents", () => {
    // "dragon" and "cinematografica" without accents — what people actually type.
    const brief = planImageFromPrompt({
      prompt: "un dragon rojo sobre un castillo, cinematografico",
    });
    expect(brief.aspectRatio.value).toBe("16:9");
    expect(brief.subjectAttributes.value).toContain("rojo");
  });

  it("handles an English prompt with no punctuation at all", () => {
    const brief = planImageFromPrompt({
      prompt: "big red dragon standing on a stone castle at night in a storm",
    });
    expect(brief.spatialRelationships.value[0]).toMatch(/standing on/i);
    expect(brief.lighting.value).toMatch(/night|storm/i);
    expect(brief.mood.value).toMatch(/threatening|dramatic/i);
  });
});

describe("exclusions and text are never invented", () => {
  it("reads what the user excluded", () => {
    const brief = planImageFromPrompt({
      prompt: "a red dragon on a castle, no people, without text",
    });
    expect(brief.exclusions.value.join(" ")).toMatch(/people/);
    expect(brief.exclusions.value.join(" ")).toMatch(/text/);
  });

  it("leaves exclusions empty when none were given", () => {
    const brief = planImageFromPrompt({ prompt: DRAGON });
    expect(brief.exclusions.value).toEqual([]);
    expect(brief.exclusions.from).toBe("default");
  });

  it("reads requested in-image text", () => {
    const brief = planImageFromPrompt({
      prompt: 'a poster of a dragon with the text "ATHEOS"',
    });
    expect(brief.textRequirements.value[0]).toBe("ATHEOS");
  });
});

describe("3. at most three questions, each one worth asking", () => {
  it("never asks more than three", () => {
    const brief = planImageFromPrompt({ prompt: "a dragon" });
    expect(imageClarificationsFor(brief).length).toBeLessThanOrEqual(3);
  });

  it("does not ask about a value the user gave", () => {
    const brief = planImageFromPrompt({
      prompt: "a photorealistic dragon, 16:9, 4K",
    });
    const asked = imageClarificationsFor(brief).map((q) => q.field);
    expect(asked).not.toContain("aspectRatio");
    expect(asked).not.toContain("realism");
    expect(asked).not.toContain("resolution");
  });

  it("marks the recommendation it would otherwise have used", () => {
    const brief = planImageFromPrompt({ prompt: DRAGON });
    const shape = imageClarificationsFor(brief).find(
      (q) => q.field === "aspectRatio",
    );
    expect(shape).toBeTruthy();
    const recommended = shape!.options.find((o) => o.recommended);
    expect(recommended?.value).toBe("16:9");
  });
});

describe("confidence reflects how much the user actually said", () => {
  it("a detailed prompt scores higher than a bare noun", () => {
    const bare = planImageFromPrompt({ prompt: "a dragon" });
    const full = planImageFromPrompt({ prompt: DRAGON });
    expect(full.overallConfidence).toBeGreaterThan(bare.overallConfidence);
  });
});
