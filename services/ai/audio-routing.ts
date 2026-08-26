import { AUDIO_CAPABILITIES } from "@/services/ai/audio-strategy";

/**
 * Which model should make this video, and what it will sound like.
 *
 * ## Why AUTO is the default
 *
 * A beginner typing "a wolf in a forest" has not thought about audio, and the
 * old behaviour answered for them badly: Motion 1 was the default, Motion 1
 * cannot produce sound, and the result was a silent clip nobody had asked to be
 * silent. AUTO reads the prompt for an actual instruction and, finding none,
 * recommends a model that can deliver sound — but it *recommends*, and the user
 * confirms, because the model that can do it costs several times more.
 *
 * ## Never switch silently
 *
 * The rule that matters commercially: a cheaper silent model must never become
 * an expensive native-audio one without the user agreeing. `requiresConfirmation`
 * is true whenever the recommendation costs more than what they had selected,
 * and the server refuses a submission whose model and audio promise disagree —
 * so the confirmation cannot be skipped by a forged request either.
 *
 * ## What Motion 1 and Motion Pro are, honestly
 *
 * Neither produces native audio. The catalogue has said so since the audio
 * capability audit, and nothing here softens it: asking for sound on Motion 1 is
 * a routing decision, not a prompt that can be phrased more persuasively.
 */

export type AudioIntent =
  "AUTO" | "NATIVE_AUDIO" | "ATHEOS_SOUND_MIX" | "SILENT";

export interface AudioRoutingResult {
  /** What the user's words asked for, after AUTO is resolved. */
  intent: AudioIntent;
  /** Why that intent was chosen, in the user's terms. */
  intentReason: string;
  /** The model that should run. May differ from the one selected. */
  recommendedModelId: string;
  /** True when the recommendation genuinely produces sound in the same pass. */
  nativeAudio: boolean;
  /** Set when the recommendation is not what the user had selected. */
  switchedFrom?: string;
  /**
   * True when the user must agree before this runs.
   *
   * Set whenever the recommendation costs more than the selection. A silent
   * model quietly becoming a paid one is the failure this prevents.
   */
  requiresConfirmation: boolean;
  /** Blocking problems. A non-empty list means the submission is refused. */
  refusals: string[];
  /** Things worth saying that do not block. */
  notes: string[];
}

/** Models that genuinely produce synchronised sound in the same pass. */
export function producesNativeAudio(modelId: string): boolean {
  const model = AUDIO_CAPABILITIES[modelId];
  return Boolean(model?.strategies.includes("NATIVE"));
}

/** The cheapest model that can deliver native audio. */
export const NATIVE_AUDIO_RECOMMENDATION = "replicate/veo-3.1-fast";

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

/**
 * Read the audio instruction out of a prompt.
 *
 * The distinctions here are the ones people actually make, and conflating them
 * is what produced silent videos nobody wanted:
 *
 *   - "no audio" / "silent" / "muted"  → genuinely silent
 *   - "no dialogue" / "no voiceover"   → **still wants** effects and ambience
 *   - "no music"                       → still wants effects and ambience
 *
 * The second and third are the traps: both contain a negation next to the word
 * audio, and a naive keyword match reads them as a request for silence.
 */
export function readAudioIntent(prompt: string): {
  intent: AudioIntent;
  reason: string;
} {
  const text = prompt.toLowerCase();

  /**
   * Silence, stated plainly. Checked first and worded tightly: "no sound"
   * qualifies, "no soundtrack" does not — that is a request about music.
   */
  const silent =
    /\b(no audio|without audio|no sound\b|without sound|silent|muted|mute it|audio off|sound off)\b/.test(
      text,
    );

  if (silent) {
    return { intent: "SILENT", reason: "you asked for this to be silent" };
  }

  /**
   * A negation that is *not* a request for silence.
   *
   * Recorded as a note rather than an intent: the user still wants sound, just
   * not that kind of sound, and the compiler already carries "no speech" and
   * "no music" into the audio direction.
   */
  if (/\bno (dialogue|speech|voice ?over|narration|talking)\b/.test(text)) {
    return {
      intent: "NATIVE_AUDIO",
      reason:
        "you asked for no dialogue, which still leaves effects and ambience",
    };
  }

  if (/\bno music\b|\bwithout music\b/.test(text)) {
    return {
      intent: "NATIVE_AUDIO",
      reason: "you asked for no music, which still leaves effects and ambience",
    };
  }

  if (
    /\b(with (sound|audio)|synchronised audio|synchronized audio|native audio|sound effects only|with sfx)\b/.test(
      text,
    )
  ) {
    return { intent: "NATIVE_AUDIO", reason: "you asked for sound" };
  }

  return {
    intent: "AUTO",
    reason: "you did not say, so Atheos chose",
  };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export function routeAudio(input: {
  prompt: string;
  /** The model currently chosen in the composer. */
  selectedModelId: string;
  /** Explicit override from the audio control, when the user has set one. */
  requestedIntent?: AudioIntent;
  /** Credit cost per model, so a switch can be described honestly. */
  creditsFor?: (modelId: string) => number | undefined;
  /** True when the caller may use native-audio models at all. */
  nativeAudioAvailable: boolean;
}): AudioRoutingResult {
  const read = readAudioIntent(input.prompt);

  /**
   * An explicit control beats the prompt.
   *
   * Someone who set the selector to Silent and then wrote "with sound" in the
   * prompt is editing one and forgetting the other; the control is the more
   * deliberate act and the panel shows which one won.
   */
  const intent =
    input.requestedIntent && input.requestedIntent !== "AUTO"
      ? input.requestedIntent
      : read.intent;

  const intentReason =
    input.requestedIntent && input.requestedIntent !== "AUTO"
      ? "you set this in the audio control"
      : read.reason;

  const refusals: string[] = [];
  const notes: string[] = [];
  const selectedHasNative = producesNativeAudio(input.selectedModelId);

  /**
   * Producing sound and being unable to *stop* producing it are different.
   *
   * This branch used to refuse silence for any model with native audio, which
   * told anyone choosing Cinematic Fast + Silent that "a silent export is not
   * available" — false. Both Cinematic tiers take `generate_audio: false`.
   * The only models that genuinely cannot be silenced are the ones whose
   * schema has no audio field at all, and `audioAlwaysOn` is what records that.
   */
  const selectedCannotBeSilenced = Boolean(
    AUDIO_CAPABILITIES[input.selectedModelId]?.audioAlwaysOn,
  );

  // --- SILENT: the cheap models are exactly right ------------------------
  if (intent === "SILENT") {
    if (selectedCannotBeSilenced) {
      notes.push(
        "This model always generates sound, so a silent export is not available on it.",
      );
    }
    return {
      intent,
      intentReason,
      recommendedModelId: input.selectedModelId,
      nativeAudio: false,
      requiresConfirmation: false,
      refusals: [],
      notes,
    };
  }

  // --- NATIVE_AUDIO: a model that cannot do it is refused, not warned ----
  if (intent === "NATIVE_AUDIO" || intent === "AUTO") {
    if (selectedHasNative) {
      return {
        intent,
        intentReason,
        recommendedModelId: input.selectedModelId,
        nativeAudio: true,
        requiresConfirmation: false,
        refusals: [],
        notes,
      };
    }

    /**
     * The selected model cannot produce sound.
     *
     * `AUTO` recommends one that can and asks. `NATIVE_AUDIO` is an explicit
     * request, so submitting the silent model anyway would deliver the opposite
     * of what was asked — that is a refusal, not a warning.
     */
    if (!input.nativeAudioAvailable) {
      if (intent === "NATIVE_AUDIO") {
        refusals.push(
          "Native audio is not available on your account yet, and the selected model cannot produce sound.",
        );
      } else {
        notes.push(
          "No model on your account produces sound, so this will be a silent video.",
        );
      }

      return {
        intent: intent === "AUTO" ? "SILENT" : intent,
        intentReason,
        recommendedModelId: input.selectedModelId,
        nativeAudio: false,
        requiresConfirmation: false,
        refusals,
        notes,
      };
    }

    const selectedCost = input.creditsFor?.(input.selectedModelId);
    const recommendedCost = input.creditsFor?.(NATIVE_AUDIO_RECOMMENDATION);
    const costsMore =
      selectedCost !== undefined &&
      recommendedCost !== undefined &&
      recommendedCost > selectedCost;

    notes.push(
      `${label(input.selectedModelId)} produces no audio. ${label(NATIVE_AUDIO_RECOMMENDATION)} generates synchronised sound in the same pass.`,
    );

    return {
      intent,
      intentReason,
      recommendedModelId: NATIVE_AUDIO_RECOMMENDATION,
      nativeAudio: true,
      switchedFrom: input.selectedModelId,
      /**
       * Always confirm a switch that costs more, and confirm an AUTO switch
       * regardless — AUTO means the user expressed no preference, and acting on
       * no preference by spending more of their credits is not a decision to
       * make on their behalf.
       */
      requiresConfirmation: costsMore || intent === "AUTO",
      refusals: [],
      notes,
    };
  }

  // --- ATHEOS_SOUND_MIX: honest about not existing yet -------------------
  refusals.push(
    "Atheos sound mix is not built yet. Choose native audio or a silent video.",
  );

  return {
    intent,
    intentReason,
    recommendedModelId: input.selectedModelId,
    nativeAudio: false,
    requiresConfirmation: false,
    refusals,
    notes,
  };
}

/**
 * Server-side check that a model and an audio promise agree.
 *
 * The client's routing is a convenience; this is the rule. A forged request
 * naming Motion 1 with native audio has to be refused here, because the
 * composer is the one place an attacker controls completely.
 */
export function rejectImpossibleAudio(input: {
  modelId: string;
  wantsNativeAudio: boolean;
}): string | null {
  if (!input.wantsNativeAudio) return null;

  if (!producesNativeAudio(input.modelId)) {
    return `${label(input.modelId)} cannot produce native audio.`;
  }

  return null;
}

function label(modelId: string): string {
  return AUDIO_CAPABILITIES[modelId]?.label ?? modelId;
}
