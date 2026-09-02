import "server-only";

/**
 * What moves, and when — the field the brief did not have.
 *
 * ## The defect this exists to close
 *
 * `CreativeBrief` described where the camera stood, what was in frame, and how
 * it was lit. It described the subject's *action* as a noun phrase — "surfing
 * a wave" — and nothing anywhere said the surfer had to travel across the
 * frame, shift their weight, or that the wave had to break.
 *
 * A brief like that is a perfectly specified **photograph**, and that is what
 * came back: a beautifully lit still with a slow push-in over it. Every
 * negative constraint in `directed-prompt.ts` was about the camera — "no
 * camera remaining on one side", "the camera jumping mid-shot" — so the
 * compiler was arguing about lens work while the subject stood still.
 *
 * ## Why "cinematic" is not a fix
 *
 * The obvious repair is to append adjectives: *cinematic*, *dynamic*,
 * *realistic movement*. They read as motion to a person and mean nothing to a
 * model — they are style words, and a model that already renders
 * photorealistically will happily render a photorealistic statue. Motion has
 * to be stated as **events with an order**: what changes at the start, what
 * displacement happens during the take, what the surroundings do, how it ends.
 *
 * `hasObservableMotion` below is the guard, and it deliberately refuses to
 * count those adjectives as evidence.
 *
 * ## Inference, not invention
 *
 * These are `inferred` or `fallback` in the brief, never `explicit`. The user
 * wrote "a surfer on a wave" and did not ask for spray; the panel shows them
 * what was added and lets them edit it. What they must not get is a silent
 * upgrade they cannot see, or a still they did not ask for either.
 */

/**
 * Where the motion decision came from.
 *
 * The distinction that matters is the third one. Inferring movement is right
 * for "a surfer on a wave", which describes a scene and says nothing about
 * whether it moves — and it is *wrong* for "a static shot of a surfer, locked
 * off camera", which says exactly that and means it. A director who asks for
 * stillness and is overruled by an inference has been ignored.
 *
 *   `explicit_dynamic`  the user asked for movement in so many words
 *   `inferred`          nothing was said, so a scene-appropriate clause was added
 *   `explicit_static`   the user asked for a held frame; nothing is added
 */
export type MotionIntent = "explicit_dynamic" | "inferred" | "explicit_static";

/** How the subject and the world move, phrased as ordered events. */
export interface SceneMotion {
  /**
   * The subject's own movement across the take: displacement, then the body
   * change that goes with it, then how it resolves.
   */
  subject: string;
  /** What the surroundings do independently of the subject. */
  environment: string;
  /** Which archetype produced this, for the editable summary. */
  archetype: string;
  /** Where the decision came from. Drives whether anything is added at all. */
  intent: MotionIntent;
}

/**
 * Phrases that ask for a held frame.
 *
 * Word-boundary anchored, and deliberately narrow: "still water" and "still
 * life" are not requests for a static camera, so `still` only counts in
 * `still frame`, `holds still` and similar. A false positive here silently
 * removes the whole feature for a prompt that wanted it.
 */
const STATIC_REQUEST =
  /\b(static shot|static camera|locked[- ]off|locked camera|lock the camera|no camera (movement|motion)|camera (does not|doesn't|never) move|still frame|freeze frame|frozen (frame|moment)|motionless|tripod( shot)?|fixed camera)\b/i;

/** Phrases in which the user has already asked for movement themselves. */
const DYNAMIC_REQUEST =
  /\b(fast[- ]paced|high[- ]energy|action[- ]packed|lots of (movement|motion)|moving quickly|in motion|tracking shot|dolly shot|handheld|whip pan|follows? (him|her|them|the)|following (him|her|them|the))\b/i;

/**
 * Read what the user asked for about movement, if anything.
 *
 * Static is checked first. A prompt saying "a locked-off tracking shot" is
 * contradictory, and the safer reading of a contradiction is the one that adds
 * nothing — a director who gets less than they asked for can ask again; one
 * whose explicit stillness was overridden has already paid for the wrong clip.
 */
export function readMotionIntent(prompt: string): MotionIntent {
  if (STATIC_REQUEST.test(prompt)) return "explicit_static";
  if (DYNAMIC_REQUEST.test(prompt)) return "explicit_dynamic";
  return "inferred";
}

/**
 * Recognised scenes, each with motion written as a sequence.
 *
 * Shaped like `audio-inference.ts` on purpose: same word-boundary matching,
 * same "first match wins", same refusal to invent anything the archetype does
 * not warrant. A scene nobody recognises gets the generic clause rather than a
 * confident wrong one.
 */
const ARCHETYPES: {
  name: string;
  pattern: RegExp;
  subject: string;
  environment: string;
}[] = [
  {
    name: "surf",
    pattern: /\b(surf(er|ing|board)?|wave riding|barrel)\b/i,
    subject:
      "the surfer paddles, pushes up and rises to their feet, then travels " +
      "along the wave face — the board visibly displaces across frame, the " +
      "body lowers and re-balances through the turn, arms counterweighting, " +
      "and the ride resolves as they carve out of the section",
    environment:
      "the wave advances and breaks behind and around them, throwing spray " +
      "and foam that drifts on the wind; the water surface is in constant " +
      "motion and the horizon shifts with the swell",
  },
  {
    name: "driving",
    pattern: /\b(car|vehicle|driv(e|ing)|motorcycle|truck|road trip)\b/i,
    subject:
      "the vehicle travels continuously in one direction, covering real " +
      "ground across the take — wheels rotating, suspension working over the " +
      "surface, body settling into the corners — and it does not stop or " +
      "reverse direction",
    environment:
      "the road, roadside and background sweep past at a speed consistent " +
      "with the vehicle; light and reflections track across the bodywork as " +
      "it moves",
  },
  {
    name: "creature",
    pattern: /\b(dragon|beast|creature|monster|bird|eagle|horse|wolf)\b/i,
    subject:
      "the creature moves under its own power throughout — limbs, wings or " +
      "body driving the motion, weight shifting between them — and its " +
      "position in frame changes from the first second to the last",
    environment:
      "the surroundings react to it: air, dust, water or foliage displaced " +
      "by its movement rather than sitting still around it",
  },
  {
    name: "person-speaking",
    pattern:
      /\b(speak(s|ing)?|talk(s|ing)?|says?|presenter|interview|monologue)\b/i,
    subject:
      "the person's posture, gesture and head position change through the " +
      "take; hands move with what they are saying and they shift their " +
      "weight rather than holding one pose",
    environment:
      "the setting behind them has its own life — light, air movement or " +
      "background activity — instead of being a frozen backdrop",
  },
  {
    name: "product",
    pattern: /\b(product|bottle|watch|shoe|perfume|packshot|commercial)\b/i,
    subject:
      "the product turns or is handled so that a different face of it is " +
      "visible at the end than at the start; any liquid, fabric or mechanism " +
      "on it moves",
    environment:
      "light sweeps across the surface as the object turns, and the " +
      "surrounding air, steam or fabric drifts rather than holding still",
  },
  {
    name: "nature",
    pattern:
      /\b(forest|mountain|river|ocean|sea|beach|waterfall|storm|desert)\b/i,
    subject:
      "the main element of the scene changes visibly across the take rather " +
      "than holding a single arrangement",
    environment:
      "water, foliage, cloud and airborne particles all move continuously; " +
      "nothing in frame is static for the full duration",
  },
];

/** The clause used when nothing is recognised. Generic, and still concrete. */
const GENERIC: Omit<SceneMotion, "archetype" | "intent"> = {
  subject:
    "the subject changes position and posture between the first and last " +
    "second — a displacement a viewer could point to, not a held pose",
  environment:
    "something in the surroundings moves independently of the subject, so " +
    "the frame is never a still photograph",
};

/**
 * Derive motion from a prompt.
 *
 * First match wins, as in the audio inference. Word boundaries throughout, so
 * "carve" does not match "car" and "surfaces" does not match "surf".
 */
export function inferSceneMotion(prompt: string): SceneMotion {
  const intent = readMotionIntent(prompt);

  /**
   * An explicit request for stillness produces no motion clause at all.
   *
   * Not a quieter one — none. The compiler then emits no MOVEMENT block, so
   * nothing anywhere in the prompt argues with the held frame the user asked
   * for.
   */
  if (intent === "explicit_static") {
    return {
      subject: "",
      environment: "",
      archetype: "static",
      intent,
    };
  }

  for (const archetype of ARCHETYPES) {
    if (archetype.pattern.test(prompt)) {
      return {
        subject: archetype.subject,
        environment: archetype.environment,
        archetype: archetype.name,
        intent,
      };
    }
  }
  return { ...GENERIC, archetype: "generic", intent };
}

/**
 * Words that describe a *look*, not a movement.
 *
 * A compiled prompt containing only these has not specified motion, however
 * cinematic it sounds. Listed rather than inferred because the failure is
 * specific and recurring: the first attempt at this feature appended
 * "cinematic, dynamic camera" and called the problem solved.
 */
export const NON_MOTION_WORDS = [
  "cinematic",
  "dynamic",
  "realistic movement",
  "lifelike",
  "high quality",
  "epic",
  "beautiful",
  "stunning",
];

/**
 * Verbs that describe something actually happening over time.
 *
 * Deliberately about displacement and change of state. A compiled video prompt
 * must contain several, across the whole clause — one "moves" bolted onto a
 * static description is the same defect wearing a verb.
 */
const MOTION_VERBS =
  /\b(travel(s|ling|ing)?|mov(e|es|ing)|advanc(e|es|ing)|ris(e|es|ing)|fall(s|ing)?|turn(s|ing)?|rotat(e|es|ing)|carv(e|es|ing)|break(s|ing)?|drift(s|ing)?|sweep(s|ing)?|shift(s|ing)?|displac(e|es|ing)|paddl(e|es|ing)|push(es|ing)?|cross(es|ing)?|approach(es|ing)?|recede(s|ing)?|accelerat(e|es|ing)|walk(s|ing)?|run(s|ning)?|fl(y|ies|ying)|swim(s|ming)?|gestur(e|es|ing)|handl(e|es|ed|ing)|throw(s|ing|n)?|settl(e|es|ing)|track(s|ing)?|change(s|d)?|shed(s|ding)?)\b/gi;

export interface MotionEvidence {
  ok: boolean;
  /** Distinct motion verbs found. Style adjectives never count. */
  verbs: string[];
  /** Style words present that were *not* treated as evidence. */
  styleWordsIgnored: string[];
  reason?: string;
}

/**
 * Does this compiled prompt actually describe movement?
 *
 * The threshold is three distinct motion verbs. Not one: a single verb is
 * satisfied by "a cinematic shot of a surfer moving", which is the sentence
 * this whole module exists to reject. Three forces the prompt to describe a
 * beginning, a middle and an end, which is what produces motion across the
 * full duration rather than in one beat.
 */
export function hasObservableMotion(compiled: string): MotionEvidence {
  const found = new Set(
    (compiled.match(MOTION_VERBS) ?? []).map((verb) => verb.toLowerCase()),
  );

  const styleWordsIgnored = NON_MOTION_WORDS.filter((word) =>
    new RegExp(`\\b${word}\\b`, "i").test(compiled),
  );

  const verbs = [...found];

  if (verbs.length < 3) {
    return {
      ok: false,
      verbs,
      styleWordsIgnored,
      reason:
        styleWordsIgnored.length > 0
          ? `describes a look (${styleWordsIgnored.join(", ")}) rather than movement`
          : "does not describe movement across the clip",
    };
  }

  return { ok: true, verbs, styleWordsIgnored };
}
