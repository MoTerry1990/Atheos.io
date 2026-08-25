import { afterEach, describe, expect, it } from "vitest";

import { MODEL_CAPABILITIES } from "@/services/ai/brief-routing";
import { compileForModel } from "@/services/ai/compile-for-model";
import { confirmField, type CreativeBrief } from "@/services/ai/creative-brief";
import {
  DirectorError,
  resolveDirectorSubmission,
} from "@/services/ai/director-submit";
import { planFromPrompt } from "@/services/ai/intent-planner";
import { generationIdForPlan } from "@/services/ai/plan-consumption";
import { issuePlanToken } from "@/services/ai/plan-token";

/**
 * The submission swap.
 *
 * ## What this closes
 *
 * `studio-workspace.tsx:283` sent `assemblePrompt(params, installedStyles)` —
 * a browser-built string — through `submitGeneration` to the adapter. The shot
 * plan the composer displayed reached nothing, which is why a four-shot request
 * came back as a 7.567-second silent single take.
 *
 * With the Director on, the client's prompt is **overridden** by the server's
 * recompilation. These tests prove the override happens, that a request without
 * a plan is refused rather than falling through to the old path, and that the
 * flag off leaves the old path exactly as it was.
 */

const NOW = 1_700_000_000_000;
const MODEL = Object.fromEntries(MODEL_CAPABILITIES.map((m) => [m.id, m]));

function directorOn() {
  process.env.ENABLE_CREATIVE_DIRECTOR = "1";
}
function directorOff() {
  delete process.env.ENABLE_CREATIVE_DIRECTOR;
}
afterEach(directorOff);

function confirmedBrief(): CreativeBrief {
  let brief = planFromPrompt({
    prompt:
      "Create an 8 second cinematic commercial of this red convertible beside the ocean",
    referenceImageCount: 1,
  });
  brief = confirmField(brief, "resolution" as never, "720p" as never);
  for (const field of brief.required) {
    const current = brief[field] as unknown as { value: unknown };
    brief = confirmField(brief, field, current.value as never);
  }
  return brief;
}

function tokenFor(brief: CreativeBrief, userId = "user_alice") {
  const model = MODEL["replicate/veo-3.1"];
  return issuePlanToken({
    userId,
    brief,
    modelId: model.id,
    // Must match what the capability table says, or the quote check fires.
    quotedCredits: model.creditsPerGeneration,
    nowMs: NOW,
  }).token;
}

describe("20. flag off leaves the existing path untouched", () => {
  it("declines to intervene", () => {
    directorOff();
    // Null means "not my business" — submitGeneration then runs unchanged.
    expect(
      resolveDirectorSubmission({ userId: "user_alice", nowMs: NOW }),
    ).toBeNull();
  });

  it("declines even when a token is supplied", () => {
    directorOff();
    const brief = confirmedBrief();
    expect(
      resolveDirectorSubmission({
        userId: "user_alice",
        planToken: tokenFor(brief),
        brief,
        confirmed: true,
        nowMs: NOW,
      }),
    ).toBeNull();
  });
});

describe("15. flag on, the raw-prompt shape fails closed", () => {
  it("refuses a submission with no plan token", () => {
    /**
     * The bypass this whole sprint exists to close. Previously this request
     * shape *was* the generation path.
     */
    directorOn();
    try {
      resolveDirectorSubmission({ userId: "user_alice", nowMs: NOW });
      throw new Error("should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(DirectorError);
      expect((error as DirectorError).code).toBe("plan_required");
      expect((error as DirectorError).status).toBe(400);
    }
  });

  it("refuses a token with no brief", () => {
    directorOn();
    expect(() =>
      resolveDirectorSubmission({
        userId: "user_alice",
        planToken: tokenFor(confirmedBrief()),
        confirmed: true,
        nowMs: NOW,
      }),
    ).toThrow(/missing its brief/);
  });

  it("refuses an unconfirmed plan", () => {
    directorOn();
    const brief = confirmedBrief();
    expect(() =>
      resolveDirectorSubmission({
        userId: "user_alice",
        planToken: tokenFor(brief),
        brief,
        confirmed: false,
        nowMs: NOW,
      }),
    ).toThrow(/not been confirmed/);
  });
});

describe("6, 11-14. the server overrides the client", () => {
  it("returns the server-compiled prompt, not anything the client sent", () => {
    directorOn();
    const brief = confirmedBrief();
    const overrides = resolveDirectorSubmission({
      userId: "user_alice",
      planToken: tokenFor(brief),
      brief,
      confirmed: true,
      nowMs: NOW,
    })!;

    // It is exactly what compileForModel produces for this brief and model.
    const compiled = compileForModel(brief, MODEL["replicate/veo-3.1"]);
    expect(overrides.prompt).toBe(compiled.prompt);

    // And it carries the shot structure the old path threw away.
    expect(overrides.prompt).toContain("SHOT 1");
    expect(overrides.prompt).toContain("HARD CUT.");
    expect(overrides.prompt.split("HARD CUT.").length - 1).toBe(3);
  });

  it("derives a generation id that collides on replay", () => {
    directorOn();
    const brief = confirmedBrief();
    const token = tokenFor(brief);
    const first = resolveDirectorSubmission({
      userId: "user_alice",
      planToken: token,
      brief,
      confirmed: true,
      nowMs: NOW,
    })!;
    const second = resolveDirectorSubmission({
      userId: "user_alice",
      planToken: token,
      brief,
      confirmed: true,
      nowMs: NOW,
    })!;
    // Same id twice → the primary key rejects the second insert.
    expect(first.generationId).toBe(second.generationId);
    expect(first.generationId).toBe(generationIdForPlan(token));
  });

  it("rejects a cross-user token", () => {
    directorOn();
    const brief = confirmedBrief();
    expect(() =>
      resolveDirectorSubmission({
        userId: "user_mallory",
        planToken: tokenFor(brief, "user_alice"),
        brief,
        confirmed: true,
        nowMs: NOW,
      }),
    ).toThrow(/no longer valid/);
  });

  it("rejects an expired token", () => {
    directorOn();
    const brief = confirmedBrief();
    expect(() =>
      resolveDirectorSubmission({
        userId: "user_alice",
        planToken: tokenFor(brief),
        brief,
        confirmed: true,
        nowMs: NOW + 3_600_000,
      }),
    ).toThrow(/no longer valid/);
  });

  it("rejects a brief changed after confirmation", () => {
    directorOn();
    const brief = confirmedBrief();
    const token = tokenFor(brief);
    const swapped = confirmField(brief, "durationSeconds", 30, "edited");
    expect(() =>
      resolveDirectorSubmission({
        userId: "user_alice",
        planToken: token,
        brief: swapped,
        confirmed: true,
        nowMs: NOW,
      }),
    ).toThrow(/no longer valid/);
  });

  it("16. rejects a token whose quote no longer matches the table", () => {
    /**
     * A signed token cannot be edited — but a capability table changed between
     * planning and submission would move the price under a confirmation the
     * user already gave. The server recalculates and refuses the mismatch.
     */
    directorOn();
    const brief = confirmedBrief();
    const cheap = issuePlanToken({
      userId: "user_alice",
      brief,
      modelId: "replicate/veo-3.1",
      quotedCredits: 1, // not what the table says
      nowMs: NOW,
    }).token;

    try {
      resolveDirectorSubmission({
        userId: "user_alice",
        planToken: cheap,
        brief,
        confirmed: true,
        nowMs: NOW,
      });
      throw new Error("should have refused");
    } catch (error) {
      expect((error as DirectorError).code).toBe("quote_changed");
      expect((error as DirectorError).status).toBe(409);
    }
  });

  it("quotes from the capability table, not from the client", () => {
    directorOn();
    const brief = confirmedBrief();
    const overrides = resolveDirectorSubmission({
      userId: "user_alice",
      planToken: tokenFor(brief),
      brief,
      confirmed: true,
      nowMs: NOW,
    })!;
    expect(overrides.quotedCredits).toBe(
      MODEL["replicate/veo-3.1"].creditsPerGeneration,
    );
  });
});

describe("planning metadata is recorded and sanitised", () => {
  it("stores hashes and counts, never URLs or payloads", () => {
    directorOn();
    const brief = confirmedBrief();
    const overrides = resolveDirectorSubmission({
      userId: "user_alice",
      planToken: tokenFor(brief),
      brief,
      confirmed: true,
      clientIdempotencyKey: "key-1",
      nowMs: NOW,
    })!;

    const json = JSON.stringify(overrides.planMetadata);
    expect(overrides.planMetadata.briefHash).toBeTruthy();
    expect(overrides.planMetadata.compilerVersion).toBe(1);
    expect(overrides.planMetadata.shotCount).toBe(4);
    // Nothing that could be a secret, a URL or a provider payload.
    expect(json).not.toMatch(/https?:\/\//);
    expect(json).not.toMatch(/SHOT 1/);
    expect(json).not.toMatch(/r8_|sk_|whsec_/);
  });
});

describe("the compiled video resolution reaches the provider", () => {
  /**
   * Found by a real 1080p benchmark that came back 1280x720.
   *
   * `compileVeo` set `parameters.resolution` from the confirmed brief and
   * nothing carried it forward, so the adapter's
   * `request.videoResolution === "1080p"` was never true and every Veo render
   * fell through to 720p. The studio offered a resolution it silently did not
   * deliver — the same defect class as a capability nobody populates.
   */
  function resolvedWith(resolution: "720p" | "1080p") {
    directorOn();
    const brief = confirmField(
      confirmedBrief(),
      "resolution" as never,
      resolution as never,
    );

    return resolveDirectorSubmission({
      userId: "user_alice",
      planToken: tokenFor(brief),
      brief,
      confirmed: true,
      nowMs: NOW,
    });
  }

  it("returns 1080p rather than dropping it", () => {
    expect(resolvedWith("1080p")?.videoResolution).toBe("1080p");
  });

  it("carries 720p just as faithfully", () => {
    // The fix forwards the compiler's choice; it does not force the higher one.
    expect(resolvedWith("720p")?.videoResolution).toBe("720p");
  });
});

describe("a model and an audio promise that disagree are refused", () => {
  // Verified rather than assumed: `assessModel` already carries this rule, so
  // the sprint's requirement was met before this test existed.
  /**
   * The brief is signed, so it cannot be edited after confirmation — but the
   * *pair* still has to be checked. A plan issued for a native-audio model and
   * submitted naming a silent one would deliver the opposite of what was
   * confirmed, and the composer is the one place an attacker controls
   * completely.
   */
  /**
   * A brief Motion 1 can otherwise make, so the audio conflict is the only one
   * left. The general capability check runs first and correctly refuses an
   * 8-second four-shot plan with a reference image — which would mask the
   * thing under test.
   */
  function motionOneBrief(strategy: "NATIVE" | "SILENT") {
    let brief = planFromPrompt({ prompt: "a wolf in a forest" });
    brief = confirmField(brief, "durationSeconds" as never, 5 as never);
    brief = confirmField(brief, "resolution" as never, "720p" as never);
    brief = confirmField(brief, "shotCount" as never, 1 as never);
    return confirmField(brief, "audioStrategy" as never, strategy as never);
  }

  it("refuses Motion 1 against a native-audio brief", () => {
    directorOn();

    const brief = motionOneBrief("NATIVE");

    try {
      resolveDirectorSubmission({
        userId: "user_alice",
        planToken: issuePlanToken({
          userId: "user_alice",
          brief,
          modelId: "replicate/video-gen",
          quotedCredits: MODEL["replicate/video-gen"].creditsPerGeneration,
          nowMs: NOW,
        }).token,
        brief,
        confirmed: true,
        nowMs: NOW,
      });
      throw new Error("should have refused");
    } catch (error) {
      /**
       * Refused by the capability check that already existed — not by a second
       * audio-specific one. A redundant check that never fires is dead code
       * pretending to be a safeguard, so the real protection is asserted here
       * rather than a duplicate being added beside it.
       */
      expect(error).toBeInstanceOf(DirectorError);
      expect((error as DirectorError).code).toBe("capability_conflict");
      expect((error as DirectorError).message).toMatch(/produces no audio/);
    }
  });

  it("allows a silent brief on Motion 1", () => {
    // The honest pairing, which must keep working.
    directorOn();

    const brief = motionOneBrief("SILENT");

    expect(
      resolveDirectorSubmission({
        userId: "user_alice",
        planToken: issuePlanToken({
          userId: "user_alice",
          brief,
          modelId: "replicate/video-gen",
          quotedCredits: MODEL["replicate/video-gen"].creditsPerGeneration,
          nowMs: NOW,
        }).token,
        brief,
        confirmed: true,
        nowMs: NOW,
      }),
    ).not.toBeNull();
  });
});
