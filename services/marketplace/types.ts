import type { MarketplaceKind } from "@/lib/generated/prisma/enums";

/**
 * What a marketplace item is.
 *
 * ## Every item is first-party, and says so
 *
 * There are no third-party publishers yet, so there are no third-party items —
 * and none pretending to be. No invented author names, no download counts, no
 * star ratings. A marketplace whose social proof is fabricated is worse than an
 * empty one: the numbers are the first thing a user trusts and the first thing
 * they will find out was untrue.
 *
 * `publisher` therefore says "Atheos" on every item, and the browse page states
 * that the catalogue is curated rather than open. When publishing opens, this
 * type gains an author and the page can start showing one honestly.
 *
 * ## Payload is discriminated by kind
 *
 * Five kinds carry genuinely different contents — a prompt pack is a list of
 * prompts, a character is a described subject — so the payload is a union
 * rather than a bag of optional fields. Installing reads the payload and knows
 * what it is holding, without a chain of `if (item.prompts)`.
 */

export type { MarketplaceKind };

export interface PromptEntry {
  id: string;
  title: string;
  prompt: string;
  negativePrompt?: string;
}

export interface StyleEntry {
  id: string;
  name: string;
  /** Appended to the prompt. Always visible before submitting. */
  fragment: string;
  hue: number;
}

export interface CharacterEntry {
  /** Text that describes the subject consistently across generations. */
  anchor: string;
  /** Traits worth keeping stable, listed so they can be edited individually. */
  traits: readonly string[];
  /** A seed that produced a usable likeness, where one exists. */
  seed?: number;
}

export interface VoiceEntry {
  id: string;
  name: string;
  description: string;
}

export type MarketplacePayload =
  | { kind: "TEMPLATE"; template: TemplatePayload }
  | { kind: "PROMPT_PACK"; prompts: readonly PromptEntry[] }
  | { kind: "STYLE_PACK"; styles: readonly StyleEntry[] }
  | { kind: "CHARACTER"; character: CharacterEntry }
  | { kind: "VOICE_PACK"; voices: readonly VoiceEntry[] };

/** A ready-made studio configuration. */
export interface TemplatePayload {
  prompt: string;
  negativePrompt?: string;
  aspectRatio: string;
  /** Style fragments applied with it, spelled out rather than referenced. */
  styleFragments: readonly string[];
  camera?: {
    shot?: string;
    angle?: string;
    lens?: string;
    lighting?: string;
  };
  /** For video templates. */
  durationSeconds?: number;
  cameraMotion?: string;
}

export interface MarketplaceItem {
  /** Stable identifier. What favourites and installs reference. */
  slug: string;
  kind: MarketplaceKind;
  title: string;
  /** One line, shown on the card. */
  summary: string;
  /** The longer explanation, on the detail panel. */
  description: string;
  category: string;
  tags: readonly string[];
  /** Accent hue, 0–360. Items have no cover art — see below. */
  hue: number;
  payload: MarketplacePayload;
  /**
   * True for everything today.
   *
   * Kept explicit rather than assumed so the interface renders the badge from
   * data, and so the day a third-party item appears it is distinguishable
   * without a release that touches every component.
   */
  official: boolean;
  /**
   * Whether installing it does anything yet.
   *
   * Voice packs are the honest case: the catalogue describes them, but audio
   * generation does not exist until a later sprint. Rather than hiding them or
   * pretending, they install and the interface says plainly that they will not
   * do anything until audio ships.
   */
  usable: boolean;
  /** Why it is not usable. Null when it is. */
  unusableReason?: string;
}

/**
 * Categories, as a closed list.
 *
 * Free-text categories drift — "Photography", "photo" and "Photographic" end up
 * as three filters holding a third of the items each. A closed list means the
 * filter row is stable and every item is reachable from it.
 */
export const CATEGORIES = [
  "Photography",
  "Film",
  "Illustration",
  "Product",
  "Brand",
  "Concept art",
  "Social",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const KIND_LABELS: Record<MarketplaceKind, string> = {
  TEMPLATE: "Template",
  PROMPT_PACK: "Prompt pack",
  STYLE_PACK: "Style pack",
  CHARACTER: "Character",
  VOICE_PACK: "Voice pack",
};

export const KIND_PLURALS: Record<MarketplaceKind, string> = {
  TEMPLATE: "Templates",
  PROMPT_PACK: "Prompt packs",
  STYLE_PACK: "Style packs",
  CHARACTER: "Characters",
  VOICE_PACK: "Voice packs",
};

/** How many things an item contains, for the card. */
export function itemSize(item: MarketplaceItem): number {
  switch (item.payload.kind) {
    case "PROMPT_PACK":
      return item.payload.prompts.length;
    case "STYLE_PACK":
      return item.payload.styles.length;
    case "VOICE_PACK":
      return item.payload.voices.length;
    default:
      return 1;
  }
}
