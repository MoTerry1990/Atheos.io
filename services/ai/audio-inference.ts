import "server-only";

/**
 * What a scene should sound like, when the user did not say.
 *
 * ## Why infer at all
 *
 * A native-audio model given no audio direction invents its own, and what it
 * invents is usually speech. Veo will happily add a narrator to a car
 * commercial nobody asked to have narrated, and an unwanted voice is far worse
 * than an imperfect ambience: it puts words in the customer's advert.
 *
 * So the compiler always sends an audio clause. The question this module
 * answers is what that clause should say when the prompt is silent on the
 * subject — and the honest default is the sound the scene would actually make,
 * with speech explicitly ruled out.
 *
 * ## Why a lexicon rather than a model call
 *
 * The alternative is asking an LLM what a scene sounds like, which costs money
 * and latency on every compile and produces a different answer each time for
 * the same prompt. Deterministic beats clever here: the same prompt must
 * compile to the same video, or a re-run is not a re-run.
 *
 * The lexicon is deliberately small. It covers the scene types Atheos is
 * actually used for, and everything else falls through to a general
 * environmental clause rather than to a guess. A wrong specific answer —
 * seagulls in a forest — is worse than a right general one.
 *
 * ## What overrides it
 *
 * Everything the user says. `readAudioIntent` in `audio-routing.ts` handles an
 * explicit request for silence before this is ever consulted, and any audio
 * the user *does* describe is used verbatim. This only fills a vacuum.
 */

/** A scene archetype and the sounds that belong to it. */
interface AudioArchetype {
  id: string;
  /** Word-boundary matched against the prompt, lowercased. */
  cues: readonly string[];
  /** What the model is told to generate. */
  sound: string;
  /**
   * Whether music is appropriate unprompted.
   *
   * Almost always false. Music is an authorial choice, and adding a score to
   * someone's documentary shot is presumptuous in a way that adding wind is
   * not. The commercial archetype is the exception, because a product film
   * without music reads as unfinished rather than as restrained.
   */
  music: boolean;
}

const ARCHETYPES: readonly AudioArchetype[] = [
  {
    id: "driving",
    cues: [
      "car",
      "cars",
      "driving",
      "drives",
      "motorway",
      "highway",
      "road",
      "coastal road",
      "sports car",
      "vehicle",
      "truck",
    ],
    sound:
      "engine note, tyre noise on the road surface, wind past the body, and the ambience of the surroundings",
    music: false,
  },
  {
    id: "creature",
    cues: [
      "dragon",
      "dragons",
      "beast",
      "monster",
      "creature",
      "griffin",
      "wyvern",
    ],
    sound:
      "the creature's roar and breath, the heavy movement of wings, wind, and the ambience of the surrounding place",
    music: false,
  },
  {
    id: "commercial",
    cues: [
      "commercial",
      "advert",
      "advertisement",
      "product",
      "brand",
      "campaign",
      "unboxing",
      "launch film",
    ],
    sound:
      "restrained cinematic sound design and understated music that supports the picture",
    music: true,
  },
  {
    id: "nature",
    cues: [
      "forest",
      "jungle",
      "woods",
      "mountain",
      "river",
      "waterfall",
      "desert",
      "meadow",
    ],
    sound:
      "the natural ambience of the location — wind, foliage, water and distant wildlife as the scene suggests",
    music: false,
  },
  {
    id: "ocean",
    cues: ["ocean", "sea", "beach", "shore", "coast", "waves", "harbour"],
    sound: "waves, water movement, wind off the water and gulls at a distance",
    music: false,
  },
  {
    id: "city",
    cues: [
      "city",
      "street",
      "downtown",
      "urban",
      "traffic",
      "alley",
      "rooftop",
      "subway",
    ],
    sound:
      "traffic at a distance, footsteps, and the general ambience of the street",
    music: false,
  },
  {
    id: "interior",
    cues: [
      "castle",
      "hall",
      "cathedral",
      "room",
      "office",
      "kitchen",
      "warehouse",
      "corridor",
    ],
    sound:
      "the room's own acoustic — reverberation, small movements and the ambience of the space",
    music: false,
  },
];

/** The clause used when nothing in the lexicon matches. */
const GENERAL =
  "the natural environmental sound the scene would make, matched to what is on screen";

export interface InferredAudio {
  /** The sound description to put in the prompt. */
  sound: string;
  /** Which archetypes fired, for the audit trail and for tests. */
  matched: readonly string[];
  /** True when music is appropriate without being asked for. */
  music: boolean;
}

/** Whole-word match, so "port" does not match "portrait". */
function mentions(haystack: string, cue: string): boolean {
  const escaped = cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

/**
 * What this scene should sound like.
 *
 * Combines every archetype that matches rather than picking one, because a
 * prompt is often several at once — "a sports car on a coastal road" is
 * driving *and* ocean, and a viewer who hears the engine but no surf notices.
 *
 * Never returns dialogue. Speech is only ever included when the user asks for
 * it, and the caller is expected to add the no-speech rule alongside this.
 */
export function inferSceneAudio(prompt: string): InferredAudio {
  const text = prompt.toLowerCase();

  const hits = ARCHETYPES.filter((archetype) =>
    archetype.cues.some((cue) => mentions(text, cue)),
  );

  if (hits.length === 0) {
    return { sound: GENERAL, matched: [], music: false };
  }

  /**
   * Capped at three.
   *
   * A prompt mentioning six archetypes produces a sound clause longer than the
   * scene description, and the model starts weighting the audio direction over
   * the picture. The first three in table order are the most concrete.
   */
  const chosen = hits.slice(0, 3);

  return {
    sound: chosen.map((archetype) => archetype.sound).join("; "),
    matched: chosen.map((archetype) => archetype.id),
    music: chosen.some((archetype) => archetype.music),
  };
}
