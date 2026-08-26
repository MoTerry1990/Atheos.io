import type { CreativeBrief } from "@/services/ai/creative-brief";
import { assessModel, type ModelCapability } from "@/services/ai/brief-routing";
import { inferSceneAudio } from "@/services/ai/audio-inference";

/**
 * One brief, one model, one compiled request — decided on the server.
 *
 * ## Why a dispatcher rather than one universal prompt
 *
 * Until now every model received the same expanded string. That is wrong in
 * both directions: Motion 1 was handed shot lists and audio direction it has no
 * way to act on, and Veo was handed nothing about the structure it *can*
 * follow. A prompt written for a model that cannot read it is noise, and noise
 * is what the model renders.
 *
 * So each model gets a compiler matched to its verified schema. The brief is
 * the same; the translation is not.
 *
 * ## The version matters
 *
 * `COMPILER_VERSION` is recorded with every generation. When a compiler
 * changes, old generations remain explicable — you can tell which rules
 * produced a given output instead of guessing from the date.
 */

export const COMPILER_VERSION = 1;

export interface CompiledRequest {
  modelId: string;
  compilerVersion: number;
  prompt: string;
  /** Only where the model declares the input. Empty string means omit. */
  negativePrompt: string;
  /** Provider-shaped extras: duration, resolution, audio flags, images. */
  parameters: Record<string, unknown>;
  /** What this compilation deliberately dropped, and why. */
  omitted: string[];
}

/** Continuity, stated once, in the order a model reads best. */
function continuityLine(brief: CreativeBrief): string {
  const rules = brief.continuityRules.value;
  if (rules.length > 0)
    return `Identical across the whole video: ${rules.join("; ")}.`;
  if (brief.subjectIdentity.value.length > 0) {
    return `Identical across the whole video: ${brief.subjectIdentity.value.join("; ")}.`;
  }
  return "";
}

/**
 * What the model is asked to render.
 *
 * ## Why the original prompt is the floor
 *
 * The structured fields come from `planFromPrompt`, and today it fills almost
 * none of them: `primarySubject` comes back empty with the reason "not
 * identified without a planner call", because the extraction step it names does
 * not exist yet. Composing only from those fields therefore produced prompts
 * with **no subject in them at all** — a request for a cup of coffee steaming on
 * a windowsill compiled to `natural daylight One continuous shot, no cuts.` and
 * would have rendered a grey clip at full price.
 *
 * So the subject decides the whole line. When the planner has identified one,
 * the structured composition is better than raw text and is used. When it has
 * not, the user's own words are the best description available and are sent as
 * written — with the derived lighting appended only if it adds something the
 * prompt did not already say.
 *
 * Falling back to `originalPrompt` rather than to silence is the point: a prompt
 * missing its subject is not a degraded result, it is a different video.
 */
function sceneLine(brief: CreativeBrief): string {
  const structured = [
    brief.visualStyle.value,
    brief.primarySubject.value,
    brief.environment.value,
    brief.action.value,
    brief.colorAndLighting.value,
  ].filter(Boolean);

  if (brief.primarySubject.value) return structured.join(". ");

  /**
   * No subject was extracted. Lead with what the user wrote.
   *
   * `originalPrompt` is preserved byte-for-byte by the planner precisely so
   * this is possible. It is trimmed of a trailing stop only so the join below
   * does not produce `dawn.. natural daylight`.
   */
  const original = brief.originalPrompt.trim().replace(/\.\s*$/, "");
  if (!original) return structured.join(". ");

  const extras = structured.filter(
    (part) => !original.toLowerCase().includes(part.toLowerCase()),
  );

  return [original, ...extras].join(". ");
}

/**
 * Motion 1 — `wan-2.2-t2v-fast`.
 *
 * Its entire input surface is prompt, seed, num_frames, resolution,
 * aspect_ratio and a few sampler knobs. No image, no negative prompt, no audio.
 * So this compiler deliberately produces **less** than the others: one
 * continuous shot, no audio sentence, no reference claim, and it says out loud
 * what it dropped rather than sending text the model will render as objects.
 */
function compileMotion1(
  brief: CreativeBrief,
  model: ModelCapability,
): CompiledRequest {
  const omitted: string[] = [];

  if (brief.shotCount.value > 1) {
    omitted.push(
      `${brief.shotCount.value}-shot structure — Motion 1 renders one continuous take`,
    );
  }
  if (brief.audioStrategy.value !== "SILENT") {
    omitted.push("audio direction — Motion 1 produces no audio");
  }
  if (brief.references.value.count > 0) {
    omitted.push("reference image — Motion 1 accepts no image input");
  }
  if (brief.negativeConstraints.value.length > 0) {
    // Appending them to the positive prompt is how "no duplicate cars" becomes
    // two cars.
    omitted.push(
      "negative constraints — Motion 1 has no negative_prompt input",
    );
  }

  const parts = [
    sceneLine(brief),
    `One continuous shot, no cuts.`,
    continuityLine(brief),
  ].filter(Boolean);

  const seconds = nearestAllowed(brief.durationSeconds.value, model);

  return {
    modelId: model.id,
    compilerVersion: COMPILER_VERSION,
    prompt: parts.join(" "),
    negativePrompt: "",
    parameters: {
      num_frames: seconds > 5 ? 121 : 81,
      resolution: "720p",
      aspect_ratio: brief.aspectRatio.value === "9:16" ? "9:16" : "16:9",
    },
    omitted,
  };
}

/** Motion Pro — seedance-1-lite. Continuous, but takes images. */
function compileMotionPro(
  brief: CreativeBrief,
  model: ModelCapability,
): CompiledRequest {
  const omitted: string[] = [];
  if (brief.shotCount.value > 1) {
    omitted.push(
      `${brief.shotCount.value}-shot structure — Motion Pro renders one continuous take`,
    );
  }
  if (brief.audioStrategy.value === "NATIVE") {
    omitted.push(
      "native audio — Motion Pro produces none; sound must be added afterwards",
    );
  }

  return {
    modelId: model.id,
    compilerVersion: COMPILER_VERSION,
    prompt: [sceneLine(brief), "One continuous shot.", continuityLine(brief)]
      .filter(Boolean)
      .join(" "),
    negativePrompt: "",
    parameters: {
      duration: nearestAllowed(brief.durationSeconds.value, model),
      resolution: brief.resolution.value,
      aspect_ratio: brief.aspectRatio.value,
      fps: 24,
    },
    omitted,
  };
}

/** The shot list, as numbered blocks separated by the cut. */
function shotBlocks(brief: CreativeBrief): string {
  const blocks: string[] = [];
  brief.shots.value.forEach((shot, index) => {
    const described = [
      shot.cameraAngle,
      shot.cameraMovement,
      shot.subjectAction,
    ]
      .filter(Boolean)
      .join(". ");
    blocks.push(
      `SHOT ${shot.index} — ${shot.start.toFixed(1)}–${shot.end.toFixed(1)}s\n${described || "as described above"}.`,
    );
    if (index < brief.shots.value.length - 1) blocks.push("HARD CUT.");
  });
  return blocks.join("\n\n");
}

/** Veo 3.1 — reference mechanism, timed shots, negative prompt, native audio. */
function compileVeo(
  brief: CreativeBrief,
  model: ModelCapability,
): CompiledRequest {
  const omitted: string[] = [];
  const sections: string[] = [];

  if (brief.shotCount.value > 1) {
    sections.push(
      `Create an edited sequence containing exactly ${brief.shotCount.value} separate shots ` +
        `and exactly ${brief.shotCount.value - 1} unmistakable hard cuts. ` +
        `Do not make one continuous orbit or uninterrupted drone movement.`,
    );
  }

  sections.push(sceneLine(brief));
  if (brief.shotCount.value > 1) sections.push(shotBlocks(brief));

  const continuity = continuityLine(brief);
  if (continuity) sections.push(continuity);

  // Text is drawn by Atheos afterwards; a misspelt slogan cannot be fixed
  // without paying for another generation.
  sections.push("Render no text, captions, titles, logos or watermarks.");

  if (brief.audioStrategy.value === "NATIVE") {
    const described = [brief.environmentalSound.value, brief.subjectSound.value]
      .filter(Boolean)
      .join(", ");

    /**
     * What the user said, or what the scene implies — never nothing.
     *
     * The fallback used to be "the natural sound of the scene", which is not
     * direction, it is a shrug. A native-audio model handed a shrug invents
     * its own audio, and what it invents is usually speech: an unasked-for
     * narrator over somebody's car advert.
     *
     * `inferSceneAudio` reads the scene instead, so a coastal drive gets
     * engine, tyres, wind and surf. Anything the user actually described wins
     * outright; this only fills a vacuum.
     */
    const inferred = described ? null : inferSceneAudio(brief.originalPrompt);
    const sound = described || inferred!.sound;

    /**
     * Music is opt-in, with one exception — and the user always outranks it.
     *
     * Scoring somebody's documentary shot uninvited is presumptuous in a way
     * that adding wind is not, so inference only ever adds music for the
     * commercial archetype, where a product film with no music reads as
     * unfinished rather than as restrained.
     *
     * But inference must never contradict a person. Someone who wrote "no
     * music" in a prompt for a product advert had the archetype fire *and*
     * said no, and the first draft of this let the archetype win — which is
     * the whole failure mode this module was supposed to avoid. Provenance
     * settles it: if the user spoke about music at all, that is the answer.
     */
    const userSpokeAboutMusic =
      brief.music.from === "explicit" ||
      brief.music.from === "confirmed" ||
      brief.music.from === "edited";

    const allowMusic = userSpokeAboutMusic
      ? brief.music.value
      : brief.music.value || (inferred?.music ?? false);

    sections.push(
      `Audio: ${sound}.` +
        // Speech is never inferred. It puts words in the customer's mouth.
        (brief.dialogue.value ? "" : " No speech, dialogue or narration.") +
        (allowMusic ? "" : " No music."),
    );
  }

  if (brief.references.value.count > 0 && !model.acceptsReferenceImages) {
    omitted.push(
      "reference images — this Veo tier takes only a first frame, so identity can drift",
    );
  }

  const parameters: Record<string, unknown> = {
    duration: nearestAllowed(brief.durationSeconds.value, model),
    resolution: brief.resolution.value,
    aspect_ratio: brief.aspectRatio.value,
    generate_audio: brief.audioStrategy.value === "NATIVE",
  };

  return {
    modelId: model.id,
    compilerVersion: COMPILER_VERSION,
    prompt: sections.filter(Boolean).join("\n\n"),
    negativePrompt: brief.negativeConstraints.value.join(", "),
    parameters,
    omitted,
  };
}

/**
 * TODO(motion-pro-upgrade): the "Cinematic Long" compiler lived here.
 *
 * Removed with the rest of the `replicate/seedance-2.5` phantom — it had no
 * registry entry, so nothing it compiled could ever be submitted. Restore it
 * alongside the registry entry, the cost entry and the `videoShape` branch, not
 * before: a compiler for a model the adapter cannot reach is a quote the user
 * is offered and then refused.
 */

/** Snap to a length the model will actually render. */
function nearestAllowed(seconds: number, model: ModelCapability): number {
  if (!model.allowedDurations?.length) {
    return Math.min(seconds, model.maxDurationSeconds);
  }
  if (model.allowedDurations.includes(seconds)) return seconds;
  const longer = model.allowedDurations.filter((d) => d >= seconds);
  return longer.length > 0
    ? Math.min(...longer)
    : Math.max(...model.allowedDurations);
}

/**
 * Exported so `tests/unit/catalogue-integrity.test.ts` can assert that every
 * compiler names a model some adapter can actually serve. A compiler for an
 * unservable model is a quote the user is offered and then refused.
 */
export const COMPILERS_BY_MODEL: Record<
  string,
  (brief: CreativeBrief, model: ModelCapability) => CompiledRequest
> = {
  "replicate/video-gen": compileMotion1,
  "replicate/video-pro": compileMotionPro,
  "replicate/veo-3.1-fast": compileVeo,
  "replicate/veo-3.1": compileVeo,
  /**
   * `veo-3.1-lite` is deliberately absent.
   *
   * It is registry- and cost-complete, but `compileVeo` always emits a negative
   * prompt and Lite's schema has no `negative_prompt` field. Until the routing
   * table carries per-model negative-prompt support, Lite stays reachable only
   * on the direct-selection path — where the adapter's own capability check
   * already drops the field — and is not offered to the Creative Director.
   */
};

export class CapabilityConflictError extends Error {
  constructor(public readonly conflicts: string[]) {
    super(`the brief cannot be made by this model: ${conflicts.join("; ")}`);
    this.name = "CapabilityConflictError";
  }
}

/**
 * Compile a confirmed brief for one model.
 *
 * Refuses an unresolved conflict rather than compiling something the model
 * cannot make. That refusal is the whole point: the previous behaviour was a
 * warning beside a Generate button that still worked, and it produced a
 * 7.57-second silent single take against a request for an edited commercial
 * with sound.
 */
export function compileForModel(
  brief: CreativeBrief,
  model: ModelCapability,
): CompiledRequest {
  const verdict = assessModel(brief, model);
  if (verdict.compatibility === "incompatible") {
    throw new CapabilityConflictError(verdict.conflicts);
  }

  const compiler = COMPILERS_BY_MODEL[model.id];
  if (!compiler) {
    throw new CapabilityConflictError([
      `no compiler is registered for ${model.id}`,
    ]);
  }

  return compiler(brief, model);
}
