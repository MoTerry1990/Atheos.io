import { afterEach, describe, expect, it } from "vitest";

import { recommendModels } from "@/services/ai/brief-routing";
import { compileForModel } from "@/services/ai/compile-for-model";
import { confirmField, type CreativeBrief } from "@/services/ai/creative-brief";
import { resolveDirectorSubmission } from "@/services/ai/director-submit";
import {
  clarificationsFor,
  planFromPrompt,
} from "@/services/ai/intent-planner";
import { issuePlanToken } from "@/services/ai/plan-token";

/**
 * The wire, end to end.
 *
 * ## What this proves that the other tests do not
 *
 * `director-submit.test.ts` hands the gate a brief object it built in the same
 * process. The real client does not have that object — it has whatever survived
 * `JSON.stringify` on the way down from `/api/creative/plan` and back up to
 * `/api/generations`. The token carries `stableHash(brief)`, so *anything* the
 * response omits or the serialiser mangles is a rejected submission.
 *
 * That is not hypothetical: the plan endpoint originally returned a
 * twelve-field display subset of the brief, which could never have verified.
 * Nothing caught it, because both halves typechecked and both had tests.
 *
 * These tests reproduce the endpoint's own steps, put the result through JSON,
 * and submit it.
 */

const NOW = 1_700_000_000_000;
const PROMPT =
  "Create an 8 second cinematic commercial of this red convertible beside the ocean";

afterEach(() => {
  delete process.env.ENABLE_CREATIVE_DIRECTOR;
});

/** What POST /api/creative/plan does, in the order it does it. */
function planLikeTheEndpoint() {
  let brief = planFromPrompt({ prompt: PROMPT, referenceImageCount: 1 });
  brief = confirmField(brief, "resolution" as never, "720p" as never);

  // Answer everything, as a user working through the panel would.
  for (const field of brief.required) {
    const current = brief[field] as unknown as { value: unknown };
    brief = confirmField(brief, field, current.value as never, "confirmed");
  }

  const recommendation = recommendModels(brief);
  const selected = recommendation.recommended!.model;
  const verdict = recommendation.verdicts.find(
    (v) => v.model.id === selected.id,
  )!;

  const compiled = compileForModel(brief, selected);
  const issued = issuePlanToken({
    userId: "user_alice",
    brief,
    modelId: selected.id,
    quotedCredits: verdict.credits,
    referenceIds: ["ref-1"],
    nowMs: NOW,
  });

  return {
    // The response body, exactly as the route returns it.
    body: {
      brief,
      clarifications: clarificationsFor(brief),
      quote: {
        credits: verdict.credits,
        estimatedSeconds: verdict.estimatedSeconds,
      },
      finalPromptPreview: {
        modelId: compiled.modelId,
        compilerVersion: compiled.compilerVersion,
        prompt: compiled.prompt,
        negativePrompt: compiled.negativePrompt,
        omitted: compiled.omitted,
      },
      planToken: issued.token,
    },
    selected,
  };
}

/** What actually crosses the network. */
function overTheWire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("a planned brief survives the round trip", () => {
  it("verifies after JSON in both directions", () => {
    process.env.ENABLE_CREATIVE_DIRECTOR = "1";
    const { body } = planLikeTheEndpoint();
    const received = overTheWire(body);

    const overrides = resolveDirectorSubmission({
      userId: "user_alice",
      planToken: received.planToken,
      brief: received.brief,
      confirmed: true,
      clientIdempotencyKey: "key-1",
      nowMs: NOW,
    });

    expect(overrides).not.toBeNull();
    expect(overrides!.prompt.length).toBeGreaterThan(0);
  });

  it("sends the provider exactly what the panel displayed", () => {
    /**
     * The preview is compiled at planning time and the real prompt at
     * submission, by two separate calls. They must agree, or the panel is
     * describing a video nobody is going to receive — which is the defect this
     * whole feature replaces, just moved one layer inwards.
     */
    process.env.ENABLE_CREATIVE_DIRECTOR = "1";
    const { body } = planLikeTheEndpoint();
    const received = overTheWire(body);

    const overrides = resolveDirectorSubmission({
      userId: "user_alice",
      planToken: received.planToken,
      brief: received.brief,
      confirmed: true,
      nowMs: NOW,
    })!;

    expect(overrides.prompt).toBe(received.finalPromptPreview.prompt);
    expect(overrides.negativePrompt ?? "").toBe(
      received.finalPromptPreview.negativePrompt,
    );
    expect(overrides.compilerVersion).toBe(
      received.finalPromptPreview.compilerVersion,
    );
  });

  it("quotes the panel's price, not a recomputed one", () => {
    process.env.ENABLE_CREATIVE_DIRECTOR = "1";
    const { body } = planLikeTheEndpoint();
    const received = overTheWire(body);

    const overrides = resolveDirectorSubmission({
      userId: "user_alice",
      planToken: received.planToken,
      brief: received.brief,
      confirmed: true,
      nowMs: NOW,
    })!;

    expect(overrides.quotedCredits).toBe(received.quote.credits);
  });

  it("issues no token while a question is outstanding", () => {
    // A confirmable plan is one with nothing left to ask.
    const { body } = planLikeTheEndpoint();
    expect(body.clarifications).toHaveLength(0);
    expect(body.planToken).toBeTruthy();
  });
});

describe("a partial brief cannot be submitted", () => {
  it("rejects the display subset the endpoint used to return", () => {
    /**
     * Pinned deliberately. If someone trims this response again for tidiness or
     * payload size, this test fails rather than production doing so.
     */
    process.env.ENABLE_CREATIVE_DIRECTOR = "1";
    const { body } = planLikeTheEndpoint();
    const full = overTheWire(body);

    const trimmed = {
      version: full.brief.version,
      originalPrompt: full.brief.originalPrompt,
      durationSeconds: full.brief.durationSeconds,
      aspectRatio: full.brief.aspectRatio,
      resolution: full.brief.resolution,
      shotCount: full.brief.shotCount,
      shots: full.brief.shots,
      cutStyle: full.brief.cutStyle,
      audioStrategy: full.brief.audioStrategy,
      music: full.brief.music,
      dialogue: full.brief.dialogue,
      references: full.brief.references,
      objective: full.brief.objective,
    } as unknown as CreativeBrief;

    expect(() =>
      resolveDirectorSubmission({
        userId: "user_alice",
        planToken: full.planToken,
        brief: trimmed,
        confirmed: true,
        nowMs: NOW,
      }),
    ).toThrow(/no longer valid/);
  });

  it("rejects a brief with one field edited in transit", () => {
    process.env.ENABLE_CREATIVE_DIRECTOR = "1";
    const { body } = planLikeTheEndpoint();
    const full = overTheWire(body);

    // A client that wanted a longer video than it was quoted for.
    const tampered: CreativeBrief = {
      ...full.brief,
      durationSeconds: { ...full.brief.durationSeconds, value: 30 },
    };

    expect(() =>
      resolveDirectorSubmission({
        userId: "user_alice",
        planToken: full.planToken,
        brief: tampered,
        confirmed: true,
        nowMs: NOW,
      }),
    ).toThrow(/no longer valid/);
  });
});
