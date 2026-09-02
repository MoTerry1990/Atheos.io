import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

/**
 * A fixed catalogue, so this file does not depend on a provider key.
 *
 * `listModels()` falls back to an explicitly-labelled mock provider when no
 * credentials are configured, which is the case in CI. Asserting against it
 * would make these tests pass or fail on whether a secret happened to be in
 * the environment — and the sprint requires zero skipped tests, so "skip when
 * unconfigured" is not available either.
 *
 * The ids are the real catalogue ids, because the policy registry is keyed by
 * them and is deliberately *not* mocked: the point is to check that policy is
 * applied, not to restate it.
 */
const FIXTURES = [
  {
    id: "replicate/flux-schnell",
    providerId: "replicate",
    displayName: "FLUX Schnell",
    modality: "IMAGE",
    creditCost: 4,
    capabilities: {
      operations: ["text-to-image"],
      aspectRatios: ["1:1", "16:9", "9:16"],
      maxOutputs: 4,
      supportsImageInput: false,
    },
  },
  {
    id: "replicate/video-gen",
    providerId: "replicate",
    displayName: "Motion 1",
    modality: "VIDEO",
    creditCost: 90,
    capabilities: {
      operations: ["text-to-video"],
      aspectRatios: ["16:9", "9:16"],
      durations: [5, 7.5],
      maxOutputs: 1,
      supportsImageInput: false,
    },
  },
  {
    id: "replicate/video-pro",
    providerId: "replicate",
    displayName: "Motion Pro",
    modality: "VIDEO",
    creditCost: 180,
    capabilities: {
      operations: ["text-to-video"],
      aspectRatios: ["16:9", "9:16"],
      durations: [5, 10],
      maxOutputs: 1,
      supportsImageInput: true,
    },
  },
  {
    id: "replicate/veo-3.1-fast",
    providerId: "replicate",
    displayName: "Cinematic Fast",
    modality: "VIDEO",
    creditCost: 360,
    capabilities: {
      operations: ["text-to-video"],
      aspectRatios: ["16:9", "9:16"],
      durations: [4, 6, 8],
      maxOutputs: 1,
      supportsImageInput: true,
    },
  },
  {
    id: "replicate/veo-3.1",
    providerId: "replicate",
    displayName: "Cinematic",
    modality: "VIDEO",
    creditCost: 960,
    capabilities: {
      operations: ["text-to-video"],
      aspectRatios: ["16:9", "9:16"],
      durations: [4, 6, 8],
      maxOutputs: 1,
      supportsImageInput: true,
    },
  },
  {
    id: "replicate/music",
    providerId: "replicate",
    displayName: "Score",
    modality: "AUDIO",
    creditCost: 20,
    capabilities: { operations: ["text-to-audio"], maxOutputs: 1 },
  },
  {
    id: "replicate/sfx",
    providerId: "replicate",
    displayName: "Foley",
    modality: "AUDIO",
    creditCost: 10,
    capabilities: { operations: ["text-to-audio"], maxOutputs: 1 },
  },
];

vi.mock("@/services/ai/registry", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  listModels: () => FIXTURES,
}));

import {
  connectorModels,
  defaultConnectorModel,
  DurationError,
  exactDuration,
  resolveConnectorModel,
  type ConnectorModel,
} from "@/services/connectors/catalogue";

/**
 * What other people's software is told Atheos can do.
 *
 * ## The three defects this replaces
 *
 * MCP's `generate_video` advertised `durationSeconds: [5, 10]` and said "ten
 * seconds costs twice five". Motion 1 accepts 5 and 7.5. The pipeline's
 * `resolveDuration` snaps a request to the *nearest* allowed value, so asking
 * for ten produced a 7.5-second clip, priced as 7.5, having been promised ten
 * twice over.
 *
 * `list_models` returned the registry unfiltered: `replicate/video-gen` and
 * `FLUX Schnell` — every provider path and vendor name the public model
 * contract exists to hide — alongside Score, which is blocked, and Motion Pro
 * and both Cinematic tiers, which no customer may buy.
 *
 * Submission would have refused those four. That is not a defence. A catalogue
 * is an offer, and a connector is not exempt because its reader is a machine.
 *
 * ## Why nearest-match is right in one place and wrong in the other
 *
 * A Studio slider is bounded by the same list it snaps to, so the user cannot
 * express an impossible value. An API caller can, and is writing code against
 * the answer — so they get told, not accommodated.
 */

const PUBLIC = connectorModels("public");
const OWNER = connectorModels("owner");

const byId = (models: ConnectorModel[], id: string) =>
  models.find((model) => model.id === id);

describe("nothing a connector returns names a vendor", () => {
  it("uses public ids, never a provider path", () => {
    for (const model of OWNER) {
      expect(model.id, model.id).not.toContain("/");
      expect(model.id, model.id).not.toMatch(/replicate|google|bytedance/i);
    }
  });

  it("uses Atheos names, never a vendor's model family", () => {
    /**
     * The id was only half of it. "FLUX Schnell" identifies Black Forest Labs'
     * model as precisely as the path does, to anyone who looks it up.
     */
    for (const model of OWNER) {
      expect(model.name, model.name).not.toMatch(
        /flux|veo|wan|seedance|musicgen|esrgan/i,
      );
    }
  });

  it("carries no provider field anywhere in the serialised object", () => {
    // Asserted over the whole object rather than named fields: whatever
    // exists, none of it may say who runs the job.
    expect(JSON.stringify(OWNER)).not.toMatch(
      /replicate|black-forest|bytedance|wan-video|google\/|prediction/i,
    );
  });
});

describe("the catalogue respects policy", () => {
  it("never offers Score to anyone", () => {
    expect(byId(PUBLIC, "score")).toBeUndefined();
    expect(byId(OWNER, "score")).toBeUndefined();
  });

  it("keeps owner-evaluation models out of the public catalogue", () => {
    for (const id of ["motion-pro", "cinematic-fast", "cinematic"]) {
      expect(byId(PUBLIC, id), id).toBeUndefined();
    }
  });

  it("gives the owner those models", () => {
    for (const id of ["motion-pro", "cinematic-fast", "cinematic"]) {
      expect(byId(OWNER, id), id).toBeDefined();
    }
  });

  it("gives everyone Motion 1", () => {
    expect(byId(PUBLIC, "motion-1")).toBeDefined();
    expect(byId(OWNER, "motion-1")).toBeDefined();
  });
});

describe("a provider path is never a working input", () => {
  it("refuses one outright", () => {
    /**
     * An integrator who wires `replicate/video-gen` into their code has built
     * something that breaks the day Atheos changes host. It must never work
     * even once.
     */
    for (const path of [
      "replicate/video-gen",
      "replicate/music",
      "google/veo-3.1",
    ]) {
      expect(resolveConnectorModel(path, "owner"), path).toBeNull();
    }
  });

  it("refuses an unknown id rather than guessing", () => {
    expect(resolveConnectorModel("", "owner")).toBeNull();
    expect(resolveConnectorModel("../../etc/passwd", "owner")).toBeNull();
  });

  it("refuses an owner-only id for a public caller", () => {
    expect(resolveConnectorModel("motion-pro", "public")).toBeNull();
    expect(resolveConnectorModel("motion-pro", "owner")).not.toBeNull();
  });

  it("refuses Score for the owner too", () => {
    expect(resolveConnectorModel("score", "owner")).toBeNull();
  });
});

describe("Motion 1 reports what it actually does", () => {
  const motion = byId(PUBLIC, "motion-1")!;

  it("accepts exactly 5 and 7.5 seconds", () => {
    expect(motion.durations).toEqual([5, 7.5]);
  });

  it("never advertises 10", () => {
    // The literal that started this.
    expect(motion.durations).not.toContain(10);
  });

  it("says it is silent", () => {
    expect(motion.audio).toBe("silent");
    expect(motion.audioNote).toMatch(/no audio|silent/i);
  });
});

describe("an impossible duration is refused, not rounded", () => {
  const motion = byId(PUBLIC, "motion-1")!;

  it("accepts 5", () => {
    expect(exactDuration(motion, 5)).toBe(5);
  });

  it("accepts 7.5", () => {
    expect(exactDuration(motion, 7.5)).toBe(7.5);
  });

  it("rejects 10", () => {
    /**
     * The whole point. Ten used to become 7.5 in silence; now it raises, and
     * the message names what is actually available so the caller can correct
     * their code rather than guess.
     */
    expect(() => exactDuration(motion, 10)).toThrow(DurationError);

    try {
      exactDuration(motion, 10);
    } catch (error) {
      expect((error as DurationError).message).toContain("5");
      expect((error as DurationError).message).toContain("7.5");
    }
  });

  it("rejects anything else that is not on the list", () => {
    for (const seconds of [0, 1, 6, 8, 12, 30, -5]) {
      expect(() => exactDuration(motion, seconds), String(seconds)).toThrow(
        DurationError,
      );
    }
  });

  it("defaults to the shortest when none is given", () => {
    // Cheapest, not longest: a caller who did not choose should not be billed
    // for the most expensive option available.
    expect(exactDuration(motion, undefined)).toBe(5);
  });

  it("returns nothing for a model that takes no duration", () => {
    const image = defaultConnectorModel("IMAGE", "public")!;
    expect(exactDuration(image, undefined)).toBeUndefined();
  });
});

describe("the Cinematic tiers, for the owner", () => {
  it("report native audio and their own durations", () => {
    const fast = byId(OWNER, "cinematic-fast")!;

    expect(fast.audio).toBe("native");
    expect(fast.durations).toEqual([4, 6, 8]);
    expect(() => exactDuration(fast, 5)).toThrow(DurationError);
  });
});

describe("the default model a connector reaches for", () => {
  it("is a public model for a public caller", () => {
    const video = defaultConnectorModel("VIDEO", "public");

    expect(video?.id).toBe("motion-1");
    expect(video?.audio).toBe("silent");
  });

  it("is never a blocked or unpoliced model", () => {
    for (const modality of ["IMAGE", "VIDEO", "AUDIO"] as const) {
      const model = defaultConnectorModel(modality, "public");
      if (!model) continue;

      expect(model.id, modality).not.toBe("score");
      expect(
        resolveConnectorModel(model.id, "public"),
        modality,
      ).not.toBeNull();
    }
  });
});

describe("a model with no policy is absent, not assumed", () => {
  it("fails closed for both callers", () => {
    /**
     * The realistic way an unreviewed endpoint reaches an integrator: somebody
     * adds a model to the registry and forgets the policy entry. Unknown must
     * mean no — and on a connector surface it must also mean *invisible*,
     * because a catalogue entry is an offer.
     *
     * `veo-3.1-lite` is the real case. It appeared the moment `ENABLE_VEO_31`
     * was set, has no policy, and is a separate endpoint on a separate pinned
     * version from the two Cinematic tiers.
     */
    expect(byId(PUBLIC, "cinematic-lite")).toBeUndefined();
    expect(byId(OWNER, "cinematic-lite")).toBeUndefined();

    expect(resolveConnectorModel("cinematic-lite", "owner")).toBeNull();
    expect(resolveConnectorModel("cinematic-lite", "public")).toBeNull();
  });
});

describe("one caller's catalogue never leaks into another's", () => {
  it("gives different answers to consecutive callers", () => {
    /**
     * The failure a cache would introduce. `connectorModels` builds per call
     * and holds no state, so this is a guard rather than a discovery — but it
     * is the guard that would have caught an owner catalogue being memoised
     * and handed to the next customer through it.
     */
    const first = connectorModels("owner").map((model) => model.id);
    const second = connectorModels("public").map((model) => model.id);
    const third = connectorModels("owner").map((model) => model.id);

    expect(second).not.toContain("motion-pro");
    expect(first).toContain("motion-pro");
    // The owner's answer is unchanged by a public call in between.
    expect(third).toEqual(first);
  });

  it("returns a fresh array each time, so a caller cannot mutate the source", () => {
    const models = connectorModels("public");
    models.push({ ...models[0]!, id: "injected" });

    expect(connectorModels("public").map((m) => m.id)).not.toContain(
      "injected",
    );
  });
});

describe("no MCP tool can charge directly", () => {
  it("does not import the function that spends credits", () => {
    /**
     * `generate_image` and `generate_video` called `submitGeneration`, so a
     * caller saying "make a video" had credits leave their account before
     * anyone had seen a price. An agent relaying that is spending someone
     * else's money without showing them the bill.
     *
     * Both tools prepare quotes now. Asserted against the route's source
     * rather than by calling it, because the property worth pinning is that
     * the spending function is not reachable from this file at all — a future
     * edit that wants it has to add the import back, visibly, in a diff.
     */
    const route = readFileSync(
      path.resolve(__dirname, "..", "..", "app/api/mcp/route.ts"),
      "utf8",
    );

    expect(route).not.toMatch(/^\s*submitGeneration,/m);
    expect(route).not.toMatch(/\bsubmitGeneration\(/);
  });

  it("tells an agent to get agreement before confirming", () => {
    // The tool description is the only instruction an agent reads. If it does
    // not say "ask first", the agent will not.
    const route = readFileSync(
      path.resolve(__dirname, "..", "..", "app/api/mcp/route.ts"),
      "utf8",
    );

    expect(route).toMatch(/wait for them to say yes/i);
    expect(route).toMatch(/confirm_generation/);
    expect(route).toMatch(/DEPRECATED/);
  });

  it("takes nothing from the request body that decides what a call costs", () => {
    /**
     * The one tool that spends reads exactly two fields: the token and the
     * idempotency key. Everything else about the generation — which model, how
     * long, how many outputs, what it costs, and whether the caller is the
     * owner — is either inside the signed token or resolved from the
     * credential.
     *
     * Asserted against the source because the failure mode is an addition
     * rather than a change: somebody adds `args.modelId` to the confirm branch
     * to make an edit-before-confirm work, and the price stops being the one
     * that was quoted.
     */
    const route = readFileSync(
      path.resolve(__dirname, "..", "..", "app/api/mcp/route.ts"),
      "utf8",
    );

    const confirm = route.slice(
      route.indexOf('case "confirm_generation"'),
      route.indexOf('case "check_generation"'),
    );

    expect(confirm).toContain("args.token");
    expect(confirm).toContain("args.idempotencyKey");

    for (const forbidden of [
      "args.credits",
      "args.creditCost",
      "args.modelId",
      "args.caller",
      "args.userId",
      "args.role",
      "args.admin",
      "args.requestHash",
      "args.provider",
      "args.durationSeconds",
      "args.outputs",
    ]) {
      expect(confirm, forbidden).not.toContain(forbidden);
    }
  });
});
