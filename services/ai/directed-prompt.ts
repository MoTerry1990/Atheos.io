import type { AudioDirectorPlan } from "@/services/ai/audio-director";
import type { VideoDirectorPlan } from "@/services/ai/video-director";

/**
 * Compile a shot plan into one prompt a capable model can direct itself from.
 *
 * ## The mistake this corrects
 *
 * The previous audit concluded that a directed multi-angle sequence "does not
 * exist at any price". That conclusion came from grepping provider schemas for
 * a structured `shot_list` field, finding none, and stopping. It was the wrong
 * test. A model with strong temporal coherence reads *"0.0–2.0s: wide rear
 * aerial establishing shot; 2.0–4.0s: elevated side tracking…"* as an execution
 * plan; the absence of a parameter named `shot_list` says nothing about whether
 * the model can follow one written in the prompt.
 *
 * So the compiled prompt **is** the shot list, and one call can produce a piece
 * with several deliberate angles — at one price, with one wait, with native
 * audio, and with continuity the model maintains internally rather than
 * continuity Atheos tries to stitch across four separate generations.
 *
 * ## Structure, and why it is in this order
 *
 * 1. **Scene** — subject, place, look. What the whole piece is of.
 * 2. **Timed beats** — the camera plan, chronological, with explicit ranges.
 * 3. **Continuity, stated once** — same car, same driver, same road, same
 *    direction of travel, same light. Repeating these inside every beat makes
 *    the prompt long and, worse, invites the model to treat each beat as its own
 *    scene that happens to share adjectives. Stated once, globally, they read as
 *    properties of the world rather than of a shot.
 * 4. **Audio** — only when audio was asked for, and only describing diegetic
 *    sound unless music was requested.
 *
 * ## What this does not do
 *
 * It does not promise the model obeys. A compiled four-beat prompt is four beats
 * *instructed*; whether four arrived is a question for the output, not the
 * request. `beatsInstructed` is therefore a separate field from anything about
 * the result, and the UI must say "best effort" until a validator has looked.
 */

export interface DirectedBeat {
  start: number;
  end: number;
  /** One line, camera-first: angle, movement, framing. */
  description: string;
}

export interface DirectedPrompt {
  /** The whole compiled instruction, ready to send as `prompt`. */
  prompt: string;
  /**
   * What to exclude, for models with a `negative_prompt` input.
   *
   * Separate rather than folded into the prompt because a model without the
   * input must not receive these as positive text — "no duplicated vehicles"
   * inside a prompt is a sentence containing "duplicated vehicles".
   */
  negativePrompt: string;
  /** The beats written into the prompt. Instructed, not achieved. */
  beats: DirectedBeat[];
  /** True when audio direction was included. */
  includesAudioDirection: boolean;
}

/**
 * Drop a leading article so "The same" can be prefixed to a subject.
 *
 * The catalogue writes subjects as "a red convertible", which is correct on its
 * own and produces "The same a red convertible" the moment anything prefixes
 * it. Caught by reading the compiled prompt before sending it rather than by a
 * type, because both halves are valid strings.
 */
function bare(phrase: string): string {
  return phrase.replace(/^(a|an|the)\s+/i, "");
}

function continuityBlock(
  plan: VideoDirectorPlan,
  multiShot: boolean,
): string[] {
  const anchors = plan.continuity.spatialAnchors.filter(Boolean);

  return [
    `Throughout the entire video: ${plan.continuity.subjectIdentity}.`,
    `The same ${bare(plan.continuity.subject)} in every frame — one vehicle only, never a second copy.`,
    // The anchor clause is dropped when there are none. Without this the
    // sentence ends "throughout, with ." — which is not a sentence.
    anchors.length > 0
      ? `The same ${bare(plan.continuity.location)} throughout, with ${anchors.join("; ")}.`
      : `The same ${bare(plan.continuity.location)} throughout.`,
    "The vehicle travels in one consistent direction for the whole piece; the camera changes position, the world does not flip.",
    `Consistent time of day and lighting throughout: ${plan.continuity.timeOfDay}, with the sun in the same place in every shot.`,
    `Consistent colour throughout: ${plan.continuity.colorPalette}.`,
    "Wheels rotate at a rate that matches the road speed, and the road surface moves past the vehicle correctly.",
    /**
     * The one line that had to become mode-aware.
     *
     * "The camera moves continuously" is correct for a single take and is a
     * direct contradiction of a hard cut. Emitted unconditionally, the compiler
     * was demanding an edit in one paragraph and forbidding it in the next.
     */
    multiShot
      ? "Each shot holds its own camera setup; the change between shots happens only at the hard cut, never as a move."
      : "Within each individual beat the camera moves continuously — it never jumps or teleports mid-beat.",
  ];
}

/**
 * What must not appear.
 *
 * Sent as `negative_prompt` where the model has one, and dropped entirely where
 * it does not — see `DirectedPrompt.negativePrompt`.
 */
export const DIRECTED_NEGATIVES = [
  "duplicate vehicles",
  "a second car appearing",
  "the driver changing appearance",
  "a different car model between shots",
  "the vehicle changing colour",
  "wheels sliding without rotating",
  "the camera jumping mid-shot",
  "the horizon flipping",
  "text overlays",
  "watermarks",
  "subtitles",
  "distorted faces",
  "extra limbs",
] as const;

/**
 * Wording that contradicts a hard cut.
 *
 * Beat descriptions come from the caller, and a caller can innocently write
 * "the drone swings around to settle behind the car" — which describes exactly
 * the continuous orbit the sequence is trying not to be. Rather than trust
 * every caller to know that, the compiler strips these in multi-shot mode.
 *
 * Exported so a test can assert none of it survives, rather than a reviewer
 * having to read every compiled prompt. Deliberately **not** global: a shared
 * /g regex carries `lastIndex` between calls, so `.test()` on it silently
 * returns false every other time. `asCutShot` builds its own global copy.
 */
export const CONTINUOUS_CAMERA_WORDING =
  /\b(one continuous|single continuous|uninterrupted camera|continuous orbit|continuous move|moves continuously|swings? (back )?(and )?around|orbits? around|without cutting|in one take)\b/i;

/** Remove continuous-move language from a shot description. */
function asCutShot(description: string): string {
  return (
    description
      .replace(new RegExp(CONTINUOUS_CAMERA_WORDING.source, "gi"), "")
      // Verbs that only made sense as the tail of the move just removed.
      .replace(/\b(to settle|and settle|settling)\b/gi, "")
      // Tidy last, so every removal above is cleaned up rather than only the
      // first. Ordering these before the removals left double spaces behind.
      .replace(/\s+([,.;])/g, "$1")
      .replace(/,\s*,/g, ",")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s,;—-]+|[\s,;—-]+$/g, "")
      .trim()
  );
}

/**
 * What a multi-shot request must not become.
 *
 * These sit in the **positive** prompt, unlike `DIRECTED_NEGATIVES`, and the
 * distinction is deliberate. Negating a visual noun is dangerous — "no
 * duplicate vehicles" is a sentence containing "duplicate vehicles", and models
 * render what a naive negation names. Negating a *process* carries no such
 * risk: "no continuous drone movement" cannot summon a car, a person or an
 * object. It can only rule out a way of shooting.
 *
 * And it has to be ruled out explicitly, because a continuous orbit is exactly
 * what the model produced when left to choose.
 */
export const MULTI_SHOT_EXCLUSIONS = [
  "no single continuous camera orbit",
  "no continuous uncut drone movement",
  "no smooth transformation between camera positions",
  "no simulated angle change without an edit",
  "no interior viewpoint",
  "no camera remaining on one side for the entire video",
] as const;

/**
 * Diegetic sound only, and never speech.
 *
 * The benchmark's sound is entirely environmental. Speech is the single fastest
 * way for generated video to announce itself — a model asked for "audio" over a
 * driving shot will often invent dialogue nobody wanted, so it is excluded by
 * name rather than left to chance.
 */
function audioBlock(audio: AudioDirectorPlan): string[] {
  const layers = audio.layers
    .filter((layer) => layer.kind !== "music")
    .map((layer) => layer.description);

  const lines = [
    `Audio: ${layers.length > 0 ? layers.join(", ") : "natural environmental sound for the scene"}.`,
    "The sound is recorded in the scene and follows the camera — closer shots hear more engine, wider shots more wind and surf.",
    "No speech, no dialogue, no voiceover, no narration.",
  ];

  const music = audio.layers.find((layer) => layer.kind === "music");
  lines.push(
    music
      ? `Music: ${music.description}, mixed under the environmental sound.`
      : "No music.",
  );

  return lines;
}

/**
 * Turn a director plan into a single directed prompt.
 *
 * `durationSeconds` is the model's actual clip length, which may differ from the
 * plan's: Veo accepts 4, 6 or 8 seconds and nothing else, so a 5-second plan is
 * rendered as 6 and the beats are rescaled to fill it. Writing beats that run to
 * 5.0s into an 8-second render leaves three seconds the prompt says nothing
 * about, which is three seconds of the model inventing an ending.
 */
export function compileDirectedPrompt(input: {
  plan: VideoDirectorPlan;
  /** The clip length actually being requested from the provider. */
  durationSeconds: number;
  audio?: AudioDirectorPlan;
  /** False for models with no `negative_prompt` input. */
  supportsNegativePrompt?: boolean;
}): DirectedPrompt {
  const { plan } = input;

  // Rescale the plan's beats onto the length the provider will actually render.
  const scale = input.durationSeconds / plan.durationSeconds;
  const beats: DirectedBeat[] = plan.shots.map((shot, index) => ({
    start: Number((shot.start * scale).toFixed(1)),
    // The last beat absorbs rounding so the plan ends exactly on the clip.
    end:
      index === plan.shots.length - 1
        ? input.durationSeconds
        : Number((shot.end * scale).toFixed(1)),
    description: [shot.angle, shot.movement, shot.framing]
      .filter(Boolean)
      .join(", "),
  }));

  const sections: string[] = [];

  sections.push(
    `${plan.visualStyle}. ${plan.continuity.subject} — ${plan.continuity.subjectIdentity} — on ${plan.continuity.location}, ${plan.continuity.timeOfDay}, ${plan.continuity.colorPalette}.`,
  );

  if (beats.length > 1) {
    /**
     * The edit is demanded first, before any shot is described.
     *
     * The previous wording opened "A single continuous N-second piece with 4
     * deliberate camera positions" - and Veo delivered exactly that: one
     * unbroken drone orbit passing through four viewpoints, with **zero** cuts
     * at any detection threshold. The model obeyed; the instruction was wrong.
     * "Camera positions" describes where a camera stands, not how a film is
     * assembled, and nothing in that sentence asked for an edit.
     *
     * So the structure now leads with the edit, names the cut count, and
     * forbids the continuous move by name - because "continuous" was the one
     * word the old prompt actually committed to.
     */
    sections.push(
      `Create an EDITED cinematic sequence containing exactly ${beats.length} ` +
        `separate shots. Use ${beats.length - 1} unmistakable hard cuts. Do not ` +
        `create one continuous orbit, tracking move, morph, or uninterrupted ` +
        `camera path.`,
    );

    // Each shot is its own block, separated by the cut. A shot list a person
    // could hand to an editor, rather than a timeline of camera positions.
    const shots: string[] = [];
    beats.forEach((beat, index) => {
      shots.push(
        `SHOT ${index + 1} — ${beat.start.toFixed(1)}–${beat.end.toFixed(1)} seconds\n${asCutShot(beat.description)}.`,
      );
      if (index < beats.length - 1) shots.push("HARD CUT.");
    });
    sections.push(shots.join("\n\n"));

    sections.push(MULTI_SHOT_EXCLUSIONS.map((rule) => `- ${rule}`).join("\n"));
  } else {
    sections.push(
      `One unbroken ${input.durationSeconds}-second shot: ${beats[0]?.description ?? "as described"}.`,
    );
  }

  sections.push(continuityBlock(plan, beats.length > 1).join(" "));

  const wantsAudio = Boolean(input.audio && input.audio.source !== "muted");
  if (wantsAudio && input.audio) {
    sections.push(audioBlock(input.audio).join(" "));
  }

  /**
   * With no negative-prompt input the prohibitions are dropped rather than
   * appended.
   *
   * "No duplicate vehicles" inside a positive prompt is a sentence containing
   * the words "duplicate vehicles", and models routinely render exactly the
   * thing a naive negation names. Silence is the safer failure.
   */
  const negativePrompt = input.supportsNegativePrompt
    ? DIRECTED_NEGATIVES.join(", ")
    : "";

  return {
    prompt: sections.join("\n\n"),
    negativePrompt,
    beats,
    includesAudioDirection: wantsAudio,
  };
}

/**
 * Snap a requested length to what the model will actually render.
 *
 * Returns the chosen length and whether it differs from the request, so the
 * quote can say "you asked for 5s, this renders 6s" instead of quietly
 * delivering a different video from the one that was priced.
 */
export function snapDuration(
  requested: number,
  allowed: readonly number[],
): { seconds: number; adjusted: boolean } {
  if (allowed.length === 0) return { seconds: requested, adjusted: false };
  if (allowed.includes(requested))
    return { seconds: requested, adjusted: false };

  // Round up rather than to nearest: a 5s request rendered as 4s loses a fifth
  // of the piece, while 6s gives the beats room and costs two seconds more.
  const longer = allowed.filter((option) => option > requested);
  const seconds =
    longer.length > 0 ? Math.min(...longer) : Math.max(...allowed);

  return { seconds, adjusted: true };
}
