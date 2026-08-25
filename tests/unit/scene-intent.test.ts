import { describe, expect, it } from "vitest";

import { readSceneIntent } from "@/services/ai/scene-intent";

/**
 * Short prompts, read as scenes.
 *
 * ## The failure these pin
 *
 * "A red dragon on a castle breathing fire" produced a generic close-up of a
 * dragon. The castle — the thing that makes it a scene rather than a creature
 * portrait — was a blurred smear behind the subject, because nothing read the
 * prompt as *subject in a place* and every composition decision downstream was
 * made against an empty brief.
 *
 * A named place is a request to see it. That is the rule these cases encode,
 * and the explicit-override cases are what stop it becoming a rule that ignores
 * the user.
 */

describe("the dragon, which is the case this exists for", () => {
  const intent = readSceneIntent("A red dragon on a castle breathing fire.");

  it("finds the dragon as the subject", () => {
    expect(intent.subject.toLowerCase()).toContain("dragon");
    expect(intent.subject.toLowerCase()).toContain("red");
  });

  it("finds the castle as an environment worth showing", () => {
    expect(intent.environment.toLowerCase()).toContain("castle");
    expect(intent.environmentIsEssential).toBe(true);
  });

  it("finds the action", () => {
    expect(intent.action.toLowerCase()).toContain("breathing");
  });

  it("chooses a wide establishing shot, not a close-up", () => {
    expect(intent.shotScale).toBe("wide");
  });

  it("puts the dragon at roughly a quarter of the frame", () => {
    // The brief asks for 25-30%. Anything near 60% is the old failure.
    expect(intent.subjectOccupancy).toBeGreaterThanOrEqual(0.2);
    expect(intent.subjectOccupancy).toBeLessThanOrEqual(0.35);
  });

  it("chooses 16:9 and says why", () => {
    expect(intent.aspectRatio).toBe("16:9");
    expect(intent.aspectReason).toMatch(/environmental scene/);
  });

  it("builds three planes of depth", () => {
    expect(intent.foreground).toBeTruthy();
    expect(intent.midground.toLowerCase()).toContain("dragon");
    expect(intent.background.toLowerCase()).toContain("castle");
  });

  it("asks for the castle complete rather than cropped", () => {
    expect(intent.background.toLowerCase()).toMatch(/complete|unclipped/);
  });

  it("stands slightly above eye level so the scene has depth", () => {
    expect(intent.cameraHeight).toBe("elevated");
  });

  it("is confident enough not to interrogate the user", () => {
    expect(intent.confidence).toBeGreaterThan(0.8);
  });
});

describe("the car, the second named case", () => {
  const intent = readSceneIntent("A red car driving beside the ocean.");

  it("separates subject, action and place", () => {
    expect(intent.subject.toLowerCase()).toContain("car");
    expect(intent.action.toLowerCase()).toContain("driving");
    expect(intent.environment.toLowerCase()).toContain("ocean");
  });

  it("frames it wide at 16:9 with the car a fraction of the frame", () => {
    expect(intent.aspectRatio).toBe("16:9");
    expect(intent.shotScale).toBe("wide");
    expect(intent.subjectOccupancy).toBeLessThanOrEqual(0.3);
  });

  it("shoots from an elevated position rather than the bumper", () => {
    expect(intent.cameraHeight).toBe("elevated");
  });
});

describe("the other environmental prompts", () => {
  const cases: [string, string, string][] = [
    ["A woman walking through a large city.", "woman", "city"],
    ["A wolf in a forest.", "wolf", "forest"],
    ["A premium streaming device in a living room.", "device", "living room"],
  ];

  for (const [prompt, subject, place] of cases) {
    it(`reads "${prompt}"`, () => {
      const intent = readSceneIntent(prompt);

      expect(intent.subject.toLowerCase()).toContain(subject);
      expect(intent.environment.toLowerCase()).toContain(place);
      expect(intent.environmentIsEssential).toBe(true);
      expect(intent.shotScale).toBe("wide");
      expect(intent.aspectRatio).toBe("16:9");
    });
  }

  it("prefers the longer place name where two overlap", () => {
    // "living room" must beat "room"; otherwise the environment reads wrong.
    const intent = readSceneIntent("A speaker in a living room.");
    expect(intent.environment.toLowerCase()).toContain("living room");
  });
});

describe("explicit user instructions always win", () => {
  it("honours a close-up even when a place is named", () => {
    /**
     * The environmental default must never override a stated intention. A user
     * who asks for a close-up in a forest wants a close-up.
     */
    const intent = readSceneIntent("Close-up portrait of a wolf in a forest.");

    expect(intent.shotScale).toBe("close");
    expect(intent.explicit.shotScale).toBe(true);
    expect(intent.subjectOccupancy).toBeGreaterThan(0.5);
  });

  it("honours macro", () => {
    const intent = readSceneIntent("Macro detail of a watch face.");
    expect(intent.shotScale).toBe("extreme_close");
    expect(intent.subjectOccupancy).toBeGreaterThan(0.8);
  });

  it("honours an explicit square", () => {
    const intent = readSceneIntent("A wolf in a forest, square format.");
    expect(intent.aspectRatio).toBe("1:1");
    expect(intent.explicit.aspectRatio).toBe(true);
    expect(intent.aspectReason).toMatch(/you asked/);
  });

  it("honours vertical social framing", () => {
    const intent = readSceneIntent(
      "Vertical commercial for a sneaker, for TikTok.",
    );
    expect(intent.aspectRatio).toBe("9:16");
    expect(intent.explicit.aspectRatio).toBe(true);
  });

  it("honours an explicit wide request with no place named", () => {
    const intent = readSceneIntent("A wide shot of a lone figure.");
    expect(intent.shotScale).toBe("wide");
    expect(intent.explicit.shotScale).toBe(true);
  });

  it("honours aerial framing", () => {
    const intent = readSceneIntent("Aerial view of a city at dawn.");
    expect(intent.cameraHeight).toBe("aerial");
  });
});

describe("prompts with no place named", () => {
  it("does not invent an environment", () => {
    /**
     * Inventing a location the user never mentioned is how a prompt acquires
     * scenery nobody asked for. No place named means no place claimed.
     */
    const intent = readSceneIntent("A portrait of a woman.");

    expect(intent.environmentIsEssential).toBe(false);
    expect(intent.environment).toBe("");
  });

  it("chooses a portrait ratio for a close human subject", () => {
    const intent = readSceneIntent("Close-up portrait of a woman.");
    expect(intent.aspectRatio).toBe("4:5");
    expect(intent.aspectReason).toMatch(/person/);
  });

  it("chooses a square for an isolated product", () => {
    const intent = readSceneIntent("A perfume bottle on white.");
    expect(intent.aspectRatio).toBe("1:1");
    expect(intent.aspectReason).toMatch(/square/);
  });

  it("keeps a simple backdrop rather than inventing depth", () => {
    const intent = readSceneIntent("A perfume bottle on white.");
    expect(intent.foreground).toBe("");
    expect(intent.background).toMatch(/uncluttered/);
  });
});

describe("honesty about what it did not understand", () => {
  it("reports low confidence on an unparseable prompt", () => {
    // The honest failure is "I am not sure what this is", which is what makes
    // the studio ask instead of committing to a guess.
    const intent = readSceneIntent("vibes");
    expect(intent.confidence).toBeLessThan(0.7);
  });

  it("still returns the text as a subject rather than nothing", () => {
    const intent = readSceneIntent("something strange and unnameable");
    expect(intent.subject).toBeTruthy();
  });

  it("survives an empty prompt", () => {
    const intent = readSceneIntent("");
    expect(intent.subject).toBe("");
    expect(intent.environmentIsEssential).toBe(false);
  });

  it("is deterministic, because the brief is hashed into a signed token", () => {
    // Two reads of one prompt must be byte-identical or a confirmed plan
    // cannot be verified at submission.
    const a = readSceneIntent("A red dragon on a castle breathing fire.");
    const b = readSceneIntent("A red dragon on a castle breathing fire.");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("lens and framing move together", () => {
  it("uses a wide-ish lens for an environmental scene, not an ultra-wide", () => {
    // An ultra-wide bows the horizon; that is the other way to get this wrong.
    const intent = readSceneIntent("A wolf in a forest.");
    expect(intent.lensMm).toBeGreaterThanOrEqual(24);
    expect(intent.lensMm).toBeLessThanOrEqual(35);
  });

  it("uses a longer lens for a close-up so faces are not distorted", () => {
    const intent = readSceneIntent("Close-up portrait of a woman.");
    expect(intent.lensMm).toBeGreaterThanOrEqual(85);
  });
});
