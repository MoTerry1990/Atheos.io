/**
 * The Creative Brief — what Atheos understood, before anything is generated.
 *
 * ## The finding that made this necessary
 *
 * `studio-workspace.tsx:283` submits `assemblePrompt(params, installedStyles)`:
 * the user's raw prompt plus style fragments. The shot plan, the continuity
 * contract, the timed beats and the audio direction are built at line 435 — for
 * the **button label**. `shot-plan.tsx` builds another for the panel.
 *
 * So the entire director apparatus is display-only. Not one character of it has
 * ever reached a provider. Every "four-shot plan" the composer has shown was
 * rendered, read by the user, and thrown away at submission — which is the real
 * reason the last output came back as one continuous 7.57-second silent take
 * from Motion 1 while the panel described an edited commercial.
 *
 * The brief exists to be the single artefact that survives from intent to
 * provider: built once, confirmed by the user, validated on the server, and
 * compiled per model. Nothing reaches a provider that is not in it.
 *
 * ## Provenance is on every field
 *
 * The other half of the failure was that inference looked like instruction. A
 * user who never said "four shots" saw four shots and could not tell whether
 * they had asked for them. Every derived value carries where it came from, so
 * the confirmation panel can show what was assumed and let it be changed.
 */

/**
 * Version 2 adds `composition`.
 *
 * Bumped because the shape changed and the version is hashed into a signed
 * plan token: a token issued against a version-1 brief must not verify against
 * a version-2 one, or a confirmation could be replayed for a different frame.
 */
export const CREATIVE_BRIEF_VERSION = 2;

/** Where a value came from. Shown to the user, never collapsed away. */
export type Provenance =
  /** The user said it, in the prompt or a control. */
  | "explicit"
  /** Atheos read it from the prompt's meaning. */
  | "inferred"
  /** Nobody said; this is the house default. */
  | "default"
  /** The user was asked and answered. */
  | "confirmed"
  /** The user changed it in the confirmation panel. */
  | "edited";

export interface Sourced<T> {
  value: T;
  from: Provenance;
  /** 0–1. Only meaningful for `inferred`. */
  confidence?: number;
  /** Why this value, in a sentence a user can read. */
  because?: string;
}

export function explicit<T>(value: T, because?: string): Sourced<T> {
  return { value, from: "explicit", because };
}
export function inferred<T>(
  value: T,
  confidence: number,
  because: string,
): Sourced<T> {
  return { value, from: "inferred", confidence, because };
}
export function fallback<T>(value: T, because: string): Sourced<T> {
  return { value, from: "default", because };
}

export type Objective =
  "commercial" | "social" | "story" | "product" | "demo" | "unspecified";

export type CutStyle = "hard_cut" | "continuous" | "crossfade";

export type ReferenceUse =
  /** Same subject, shot for shot. Needs a model with reference support. */
  | "preserve_exactly"
  /** Guides composition and look, identity may drift. */
  | "visual_guidance"
  /** Palette and mood only. */
  | "style_only";

export interface BriefShot {
  index: number;
  start: number;
  end: number;
  cameraAngle: string;
  cameraMovement: string;
  subjectAction: string;
}

/** How the frame is arranged. Every field is directable by the user. */
export interface Composition {
  shotScale: "extreme_close" | "close" | "medium" | "wide" | "extreme_wide";
  /** Fraction of the frame the subject should occupy, 0-1. */
  subjectOccupancy: number;
  cameraHeight: "low" | "eye" | "elevated" | "aerial";
  /** A lens family in millimetres, not a precise focal length. */
  lensMm: number;
  /** True when the named place is part of the request rather than a backdrop. */
  environmentIsEssential: boolean;
  /** The preposition the user wrote, so the compiled sentence reads correctly. */
  environmentPreposition: string;
  foreground: string;
  midground: string;
  background: string;
}

export interface CreativeBrief {
  version: number;
  /** Never modified. Not normalised, not trimmed, not re-cased. */
  originalPrompt: string;

  objective: Sourced<Objective>;
  primarySubject: Sourced<string>;
  /** What must stay identical. Empty when identity does not matter. */
  subjectIdentity: Sourced<string[]>;
  environment: Sourced<string>;
  action: Sourced<string>;
  /**
   * How the shot is framed.
   *
   * Added in version 2. Before it, every composition decision was made against
   * nothing: the compiler had a subject and a place and no instruction about
   * how much of the frame each should occupy, so a text-to-image model did what
   * it does by default — filled the frame with the subject and smeared the
   * location behind it.
   */
  composition: Sourced<Composition>;
  visualStyle: Sourced<string>;
  realism: Sourced<"photorealistic" | "stylised" | "animated">;
  colorAndLighting: Sourced<string>;

  durationSeconds: Sourced<number>;
  aspectRatio: Sourced<"16:9" | "9:16" | "1:1">;
  resolution: Sourced<"720p" | "1080p">;

  shotCount: Sourced<number>;
  shots: Sourced<BriefShot[]>;
  cutStyle: Sourced<CutStyle>;
  continuityRules: Sourced<string[]>;

  audioStrategy: Sourced<"NATIVE" | "ATHEOS_SOUND_DESIGN" | "SILENT">;
  environmentalSound: Sourced<string>;
  subjectSound: Sourced<string>;
  music: Sourced<boolean>;
  dialogue: Sourced<boolean>;

  /** Copy is rendered by Atheos, never by the model. */
  commercialCopy: Sourced<string[]>;
  logoOverlay: Sourced<boolean>;
  negativeConstraints: Sourced<string[]>;

  references: Sourced<{ count: number; use: ReferenceUse }>;

  /** Fields the user must not have silently overridden. */
  required: readonly (keyof CreativeBrief)[];
  /** 0–1 across the brief as a whole. Low means ask questions. */
  overallConfidence: number;
}

/** Every field that was assumed rather than asked for. */
export function assumptionsIn(brief: CreativeBrief): {
  field: string;
  value: unknown;
  because: string;
}[] {
  const out: { field: string; value: unknown; because: string }[] = [];
  for (const [key, entry] of Object.entries(brief)) {
    if (!entry || typeof entry !== "object" || !("from" in entry)) continue;
    const sourced = entry as Sourced<unknown>;
    if (sourced.from === "inferred" || sourced.from === "default") {
      out.push({
        field: key,
        value: sourced.value,
        because: sourced.because ?? "",
      });
    }
  }
  return out;
}

/**
 * Has the user actually agreed to this?
 *
 * A brief still carrying inferences has not been confirmed, however many times
 * it has been rendered. The generation path checks this rather than trusting a
 * client flag, because a forged request is exactly where an unconfirmed brief
 * would arrive.
 */
export function isConfirmed(brief: CreativeBrief): boolean {
  return brief.required.every((field) => {
    const entry = brief[field] as unknown;
    if (!entry || typeof entry !== "object" || !("from" in entry)) return false;
    const from = (entry as Sourced<unknown>).from;
    return from === "explicit" || from === "confirmed" || from === "edited";
  });
}

/**
 * Mark a field as the user's own, after they confirmed or edited it.
 *
 * Returns a new brief. Mutating in place is how a confirmation ends up applied
 * to a brief the user never saw.
 */
export function confirmField<K extends keyof CreativeBrief>(
  brief: CreativeBrief,
  field: K,
  value: CreativeBrief[K] extends Sourced<infer V> ? V : never,
  how: "confirmed" | "edited" = "confirmed",
): CreativeBrief {
  const current = brief[field] as unknown as Sourced<unknown>;
  return {
    ...brief,
    [field]: { ...current, value, from: how, confidence: undefined },
  };
}
