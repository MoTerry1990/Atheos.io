import { describe, expect, it } from "vitest";

import { MODEL_CAPABILITIES } from "@/services/ai/brief-routing";
import {
  CapabilityConflictError,
  compileForModel,
  COMPILER_VERSION,
} from "@/services/ai/compile-for-model";
import { confirmField, type CreativeBrief } from "@/services/ai/creative-brief";
import { planFromPrompt } from "@/services/ai/intent-planner";
import {
  issuePlanToken,
  PLAN_TTL_SECONDS,
  stableHash,
  verifyPlanToken,
} from "@/services/ai/plan-token";

/**
 * The vertical: brief → confirmation → server compilation.
 *
 * ## The hole these close
 *
 * `studio-workspace.tsx:283` sent `assemblePrompt(params, installedStyles)` —
 * a string the *browser* built — straight to the provider. Anything the browser
 * could construct, anyone could: the model, the duration and the prompt were all
 * client authority, and the shot plan shown beside the button reached nothing.
 *
 * So the token carries no prompt. It carries hashes of what was confirmed, and
 * the server recompiles from the brief every time. A token that contained the
 * compiled prompt would be a token somebody could edit to change it.
 */

const MODEL = Object.fromEntries(MODEL_CAPABILITIES.map((m) => [m.id, m]));
const NOW = 1_700_000_000_000;

/** A brief the current catalogue can actually make: 8s, 720p, four shots. */
function achievableBrief(): CreativeBrief {
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

/**
 * A brief every model can take: one continuous silent shot.
 *
 * Needed because comparing compilers requires each one to actually run, and
 * Motion 1 and Motion Pro are — correctly — incompatible with a four-shot
 * brief that asks for sound.
 */
function continuousSilentBrief(): CreativeBrief {
  let brief = planFromPrompt({
    prompt:
      "a red convertible on a coast road, one continuous shot, silent, 5 seconds",
  });
  brief = confirmField(brief, "resolution" as never, "720p" as never);
  for (const field of brief.required) {
    const current = brief[field] as unknown as { value: unknown };
    brief = confirmField(brief, field, current.value as never);
  }
  return brief;
}

describe("6-7, 18. Motion 1 is blocked, not warned", () => {
  it("refuses to compile a four-shot audio brief", () => {
    /**
     * The old behaviour warned and generated anyway, producing 7.567s of silent
     * single take. A compiler that throws cannot be ignored by a button.
     */
    const brief = achievableBrief();
    expect(() => compileForModel(brief, MODEL["replicate/video-gen"])).toThrow(
      CapabilityConflictError,
    );
  });

  it("names every conflict rather than failing vaguely", () => {
    const brief = achievableBrief();
    try {
      compileForModel(brief, MODEL["replicate/video-gen"]);
      throw new Error("should have refused");
    } catch (error) {
      const conflicts = (error as CapabilityConflictError).conflicts;
      expect(conflicts.join(" ")).toMatch(/no audio/);
      expect(conflicts.join(" ")).toMatch(/cannot follow a 4-shot plan/);
      expect(conflicts.join(" ")).toMatch(/accepts no image/);
    }
  });

  it("compiles one continuous shot when Motion 1 can actually do the job", () => {
    // 720p and silent, because Motion 1 renders nothing else — a brief left at
    // the 1080p default is refused, correctly, by the check above.
    const compiled = compileForModel(
      continuousSilentBrief(),
      MODEL["replicate/video-gen"],
    );

    expect(compiled.prompt).toContain("One continuous shot, no cuts.");
    // No shot list, no audio sentence, no negative prompt — none of which this
    // model can read, and all of which it would otherwise render as objects.
    expect(compiled.prompt).not.toContain("SHOT 1");
    expect(compiled.prompt).not.toContain("HARD CUT");
    expect(compiled.prompt).not.toMatch(/Audio:/);
    expect(compiled.negativePrompt).toBe("");
  });
});

describe("17. the compiler is chosen by model, and they differ", () => {
  const brief = achievableBrief();

  it("gives Veo the shot structure that Motion 1 never receives", () => {
    const veo = compileForModel(brief, MODEL["replicate/veo-3.1"]);
    expect(veo.prompt).toContain("SHOT 1");
    expect(veo.prompt).toContain("HARD CUT.");
    expect(veo.prompt.split("HARD CUT.").length - 1).toBe(3);

    // The same brief on a continuous model gets no shot list at all.
    const continuous = continuousSilentBrief();
    const motion1 = compileForModel(continuous, MODEL["replicate/video-gen"]);
    expect(motion1.prompt).not.toContain("SHOT 1");
    expect(motion1.prompt).toContain("One continuous shot");
  });

  it("compiles the same brief differently for different models", () => {
    /**
     * The point of the dispatcher. One brief, three models, three different
     * requests — rather than one expanded string sent everywhere.
     *
     * Was four, the fourth being `seedance-2.5`. It had a compiler and no
     * registry entry, so this assertion was proving that a model nothing could
     * submit to compiled differently from three that could.
     */
    const continuous = continuousSilentBrief();
    const outputs = [
      "replicate/video-gen",
      "replicate/video-pro",
      "replicate/veo-3.1",
    ].map((id) => compileForModel(continuous, MODEL[id]));

    const prompts = new Set(outputs.map((o) => o.prompt));
    expect(prompts.size).toBeGreaterThan(1);
    // And each carries provider-shaped parameters, not one generic shape.
    expect(outputs[0].parameters).toHaveProperty("num_frames");
    expect(outputs[1].parameters).toHaveProperty("fps");
    expect(outputs[2].parameters).toHaveProperty("generate_audio");
  });

  it("sends a negative prompt only where the input exists", () => {
    const continuous = continuousSilentBrief();
    const pro = compileForModel(continuous, MODEL["replicate/video-pro"]);
    const motion1 = compileForModel(continuous, MODEL["replicate/video-gen"]);

    // Neither seedance-1-lite nor wan-2.2 has a negative_prompt field.
    expect(pro.negativePrompt).toBe("");
    expect(motion1.negativePrompt).toBe("");
    expect(
      typeof compileForModel(brief, MODEL["replicate/veo-3.1"]).negativePrompt,
    ).toBe("string");
  });

  it("stamps the compiler version on every output", () => {
    for (const id of Object.keys(MODEL)) {
      try {
        expect(compileForModel(brief, MODEL[id]).compilerVersion).toBe(
          COMPILER_VERSION,
        );
      } catch (error) {
        // Motion 1 refuses this brief; that is the other test's subject.
        expect(error).toBeInstanceOf(CapabilityConflictError);
      }
    }
  });

  it("snaps duration to what each model renders", () => {
    const veo = compileForModel(brief, MODEL["replicate/veo-3.1"]);
    expect(veo.parameters.duration).toBe(8);
  });

  it("says out loud what it dropped", () => {
    const fast = compileForModel(brief, MODEL["replicate/veo-3.1-fast"]);
    // Fast has no reference_images input, only a first frame.
    expect(fast.omitted.join(" ")).toMatch(/identity can drift/);
  });
});

describe("22. audio capability is enforced at compile time", () => {
  it("turns generate_audio on only for a native brief", () => {
    const brief = achievableBrief();
    const veo = compileForModel(brief, MODEL["replicate/veo-3.1"]);
    expect(veo.parameters.generate_audio).toBe(true);
    expect(veo.prompt).toMatch(/No speech, dialogue or narration/);
    expect(veo.prompt).toMatch(/No music/);
  });

  it("drops audio entirely for a silent brief", () => {
    let brief = planFromPrompt({ prompt: "a red car, 8 seconds, silent" });
    for (const field of brief.required) {
      const current = brief[field] as unknown as { value: unknown };
      brief = confirmField(brief, field, current.value as never);
    }
    const veo = compileForModel(brief, MODEL["replicate/veo-3.1"]);
    expect(veo.parameters.generate_audio).toBe(false);
    expect(veo.prompt).not.toMatch(/Audio:/);
  });
});

describe("11-16. the plan token is the server's authority", () => {
  const brief = achievableBrief();

  function issue(
    overrides: Partial<Parameters<typeof issuePlanToken>[0]> = {},
  ) {
    return issuePlanToken({
      userId: "user_alice",
      brief,
      modelId: "replicate/veo-3.1",
      quotedCredits: 1920,
      nowMs: NOW,
      ...overrides,
    });
  }

  it("verifies a token it issued", () => {
    const { token } = issue();
    const result = verifyPlanToken({
      token,
      userId: "user_alice",
      brief,
      nowMs: NOW + 1000,
    });
    expect(result.ok).toBe(true);
    expect(result.payload?.quotedCredits).toBe(1920);
  });

  it("carries no compiled prompt", () => {
    /**
     * 12. The server recompiles from the brief every time. A prompt inside the
     * token would be a prompt somebody could edit.
     */
    const { token, payload } = issue();
    expect(Object.keys(payload)).not.toContain("prompt");
    expect(Object.keys(payload)).not.toContain("compiledPrompt");
    const decoded = Buffer.from(token.split(".")[0], "base64url").toString(
      "utf8",
    );
    expect(decoded).not.toContain("SHOT 1");
    expect(decoded).not.toContain("HARD CUT");
  });

  it("rejects a forged signature", () => {
    const { token } = issue();
    const [body] = token.split(".");
    const forged = `${body}.${"A".repeat(43)}`;
    expect(
      verifyPlanToken({
        token: forged,
        userId: "user_alice",
        brief,
        nowMs: NOW,
      }).reason,
    ).toBe("bad_signature");
  });

  it("rejects an edited payload", () => {
    // 11. Raising the credit total after confirmation must not verify.
    const { token } = issue();
    const [body, signature] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    payload.quotedCredits = 1;
    const tampered =
      Buffer.from(JSON.stringify(payload), "utf8").toString("base64url") +
      "." +
      signature;
    expect(
      verifyPlanToken({
        token: tampered,
        userId: "user_alice",
        brief,
        nowMs: NOW,
      }).reason,
    ).toBe("bad_signature");
  });

  it("rejects another user's plan", () => {
    const { token } = issue();
    expect(
      verifyPlanToken({ token, userId: "user_mallory", brief, nowMs: NOW })
        .reason,
    ).toBe("wrong_user");
  });

  it("rejects an expired plan", () => {
    const { token } = issue();
    const later = NOW + PLAN_TTL_SECONDS * 1000 + 1;
    expect(
      verifyPlanToken({ token, userId: "user_alice", brief, nowMs: later })
        .reason,
    ).toBe("expired");
  });

  it("rejects a brief swapped after confirmation", () => {
    /**
     * The attack the signature alone would miss: confirm a cheap plan, then
     * submit an expensive brief with the valid token.
     */
    const { token } = issue();
    const swapped = confirmField(brief, "durationSeconds", 30, "edited");
    expect(
      verifyPlanToken({
        token,
        userId: "user_alice",
        brief: swapped,
        nowMs: NOW,
      }).reason,
    ).toBe("brief_changed");
  });

  it("rejects a changed original prompt", () => {
    const { token } = issue();
    const rewritten = {
      ...brief,
      originalPrompt: brief.originalPrompt + " and a dragon",
    };
    expect(
      verifyPlanToken({
        token,
        userId: "user_alice",
        brief: rewritten,
        nowMs: NOW,
      }).reason,
    ).toMatch(/prompt_changed|brief_changed/);
  });

  it("rejects a malformed token", () => {
    for (const bad of ["", "nodot", "a.b.c.d"]) {
      const r = verifyPlanToken({
        token: bad,
        userId: "user_alice",
        brief,
        nowMs: NOW,
      });
      expect(r.ok, bad).toBe(false);
    }
  });

  it("hashes independently of key order", () => {
    // Two objects that differ only in insertion order are the same plan.
    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });
});

describe("9-10, 25. nothing is spent before confirmation", () => {
  it("plans and compiles without touching a provider", () => {
    /**
     * Every function in this flow is pure. There is no fetch, no client, and no
     * credit reservation anywhere between the prompt and the compiled request —
     * which is what makes "no provider call before confirmation" a property of
     * the code rather than a promise about it.
     */
    const brief = achievableBrief();
    const compiled = compileForModel(brief, MODEL["replicate/veo-3.1"]);
    expect(compiled.prompt.length).toBeGreaterThan(0);
    expect(compiled.parameters).toBeTruthy();
  });

  it("compiles deterministically, so the displayed prompt is the sent prompt", () => {
    // 20. The panel can show exactly what the server will send because the
    // server derives it from the same brief with the same function.
    const brief = achievableBrief();
    const a = compileForModel(brief, MODEL["replicate/veo-3.1"]);
    const b = compileForModel(brief, MODEL["replicate/veo-3.1"]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("21. leaves the original prompt untouched through the whole flow", () => {
    const original =
      "Create an 8 second cinematic commercial of this red convertible beside the ocean";
    const brief = achievableBrief();
    expect(brief.originalPrompt).toBe(original);
    compileForModel(brief, MODEL["replicate/veo-3.1"]);
    expect(brief.originalPrompt).toBe(original);
  });
});
