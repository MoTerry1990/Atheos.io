import type { CreativeBrief } from "@/services/ai/creative-brief";
import { assessModel, type ModelCapability } from "@/services/ai/brief-routing";

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
 * ## Why this composes a sentence rather than joining fields
 *
 * The first version joined the structured fields with ". ", which produced
 * `A red dragon. a castle. breathing fire. natural daylight` — grammatically
 * broken, and worse, it threw away the *relationship*. "On a castle" is the
 * whole request; "a castle" as a separate fragment is just another noun the
 * model may render anywhere, at any size.
 *
 * So the line is written as direction: the shot scale first, then subject and
 * action, then where they are, then how much of the frame each should take.
 * That last part is the fix for the reported failure — a text-to-image model
 * with no framing instruction fills the frame with the subject and reduces the
 * location to a blur behind it.
 *
 * ## The original prompt is still the floor
 *
 * When nothing was extracted, the user's own words are the best description
 * available and are sent as written. A prompt missing its subject is not a
 * degraded result, it is a different image.
 */
const SCALE_PHRASE: Record<string, string> = {
  extreme_close: "Extreme close-up",
  close: "Close-up",
  medium: "Medium shot",
  wide: "Wide establishing shot",
  extreme_wide: "Extreme wide aerial shot",
};

const HEIGHT_PHRASE: Record<string, string> = {
  low: "from a low angle",
  eye: "at eye level",
  elevated: "from a slightly elevated position",
  aerial: "from high above",
};

/** "a castle" -> "a castle"; "the ocean" -> "the ocean". Keeps the article. */
function stripArticle(phrase: string): string {
  return phrase.trim().replace(/\.$/, "");
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Lower-case a leading article so the sentence reads.
 *
 * "Wide establishing shot of A red dragon" is wrong; "of a red dragon" is
 * right. Only a leading article is touched, so a proper noun keeps its capital.
 */
function lowerFirst(text: string): string {
  return /^(a|an|the)\s/i.test(text)
    ? text.charAt(0).toLowerCase() + text.slice(1)
    : text;
}

function sceneLine(brief: CreativeBrief): string {
  const subject = brief.primarySubject.value;

  if (subject) {
    const c = brief.composition.value;
    const sentences: string[] = [];

    // "Wide establishing shot of a red dragon breathing fire, on a castle."
    const opening = [
      SCALE_PHRASE[c.shotScale] ?? "Shot",
      "of",
      brief.action.value
        ? `${lowerFirst(subject)} ${brief.action.value}`
        : lowerFirst(subject),
    ].join(" ");

    sentences.push(
      brief.environment.value
        ? `${opening}, ${c.environmentPreposition} ${stripArticle(brief.environment.value)}.`
        : `${opening}.`,
    );

    /**
     * The framing instruction, stated as proportions.
     *
     * A percentage is something a model can act on in a way that "wide shot"
     * alone is not — and it is the difference between a castle with a dragon on
     * it and a dragon with a castle behind it.
     */
    /**
     * Only insist on the whole location for a wide frame.
     *
     * A user who asked for a close-up in a forest wants the wolf, not an
     * uncropped forest — demanding both is a contradiction the model resolves
     * by ignoring one of them.
     */
    const wantsWholeLocation =
      c.environmentIsEssential &&
      (c.shotScale === "wide" || c.shotScale === "extreme_wide");

    if (wantsWholeLocation && brief.environment.value) {
      const subjectPercent = Math.round(c.subjectOccupancy * 100);
      sentences.push(
        `The subject occupies roughly ${subjectPercent}% of the frame; ` +
          `${stripArticle(brief.environment.value)} fills the rest and is visible in full, not cropped.`,
      );
    }

    if (c.foreground && wantsWholeLocation) {
      sentences.push(
        `Layered depth: ${c.foreground}, the subject in the midground, and the wider location behind.`,
      );
    }

    // Camera, as a sentence rather than a tag list.
    sentences.push(
      `Shot on a ${c.lensMm}mm lens ${HEIGHT_PHRASE[c.cameraHeight] ?? "at eye level"}, natural perspective and realistic scale.`,
    );

    const finish = [brief.visualStyle.value, brief.colorAndLighting.value]
      .filter(Boolean)
      .join(", ");
    if (finish) sentences.push(`${capitalise(finish)}.`);

    return sentences.join(" ");
  }

  const structured = [
    brief.visualStyle.value,
    brief.environment.value,
    brief.action.value,
    brief.colorAndLighting.value,
  ].filter(Boolean);

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
    const sound = [brief.environmentalSound.value, brief.subjectSound.value]
      .filter(Boolean)
      .join(", ");
    sections.push(
      `Audio: ${sound || "the natural sound of the scene"}.` +
        (brief.dialogue.value ? "" : " No speech, dialogue or narration.") +
        (brief.music.value ? "" : " No music."),
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
