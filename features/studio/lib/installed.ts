import type { PromptTemplate, StylePreset } from "@/features/studio/types";
import type { InstalledItem } from "@/features/marketplace/lib/api";

/**
 * Marketplace installs, as the composer needs them.
 *
 * ## Why a mapper rather than a shared type
 *
 * A marketplace prompt pack and a studio prompt template are nearly the same
 * shape and are not the same thing: a pack entry has no preset ids and no
 * category, and a studio template has no notion of which pack it came from.
 * Making one type serve both would mean optional fields on both sides and a
 * marketplace payload that has to change whenever the composer does.
 *
 * ## Attribution survives the mapping
 *
 * Every derived item carries the pack it came from, so the composer can group
 * and label them. An installed prompt sitting anonymously beside the built-in
 * ones is how somebody ends up unable to work out where a prompt came from —
 * and unable to remove it, because they cannot tell which pack to uninstall.
 *
 * ## Ids are namespaced
 *
 * `mp:{slug}:{entryId}`. A pack whose style is called `cinematic` must not
 * collide with the built-in `cinematic` preset — the collision would silently
 * apply the wrong fragment, which is exactly the class of bug the studio's
 * "presets are visible text" rule exists to prevent.
 */

export interface InstalledContent {
  templates: (PromptTemplate & { source: string })[];
  styles: (StylePreset & { source: string })[];
  characters: {
    id: string;
    name: string;
    anchor: string;
    traits: readonly string[];
    seed?: number;
    source: string;
  }[];
  /** Installed but not usable yet — voice packs, today. */
  waiting: { slug: string; title: string; kind: string }[];
}

export const EMPTY_INSTALLED: InstalledContent = {
  templates: [],
  styles: [],
  characters: [],
  waiting: [],
};

/**
 * The snapshot is `unknown` because it came out of a JSON column.
 *
 * It is our own data, written by our own installer, but it has been through the
 * database and back — and a payload shape that changed between the install and
 * this read is a real possibility once packs are edited. So it is narrowed
 * rather than cast: a malformed snapshot contributes nothing instead of
 * throwing inside the composer.
 */
export function mapInstalled(items: InstalledItem[]): InstalledContent {
  const result: InstalledContent = {
    templates: [],
    styles: [],
    characters: [],
    waiting: [],
  };

  for (const item of items) {
    const payload = item.snapshot;
    if (!isRecord(payload)) continue;

    switch (payload.kind) {
      case "PROMPT_PACK": {
        if (!Array.isArray(payload.prompts)) break;
        for (const entry of payload.prompts) {
          if (!isRecord(entry)) continue;
          if (
            typeof entry.id !== "string" ||
            typeof entry.prompt !== "string"
          ) {
            continue;
          }
          result.templates.push({
            id: `mp:${item.slug}:${entry.id}`,
            name: typeof entry.title === "string" ? entry.title : entry.id,
            category: item.title,
            prompt: entry.prompt,
            negativePrompt:
              typeof entry.negativePrompt === "string"
                ? entry.negativePrompt
                : undefined,
            presetIds: [],
            source: item.title,
          });
        }
        break;
      }

      case "STYLE_PACK": {
        if (!Array.isArray(payload.styles)) break;
        for (const entry of payload.styles) {
          if (!isRecord(entry)) continue;
          if (
            typeof entry.id !== "string" ||
            typeof entry.fragment !== "string"
          ) {
            continue;
          }
          result.styles.push({
            id: `mp:${item.slug}:${entry.id}`,
            name: typeof entry.name === "string" ? entry.name : entry.id,
            fragment: entry.fragment,
            hue: typeof entry.hue === "number" ? entry.hue : 268,
            source: item.title,
          });
        }
        break;
      }

      case "TEMPLATE": {
        const template = payload.template;
        if (!isRecord(template) || typeof template.prompt !== "string") break;

        // A template's style fragments are inlined into a single preset rather
        // than becoming separate chips. They were authored as a set, and
        // letting half of one be toggled off would produce a look the author
        // never tested.
        const fragments = Array.isArray(template.styleFragments)
          ? template.styleFragments.filter(
              (fragment): fragment is string => typeof fragment === "string",
            )
          : [];

        const styleId = `mp:${item.slug}:style`;
        if (fragments.length > 0) {
          result.styles.push({
            id: styleId,
            name: item.title,
            fragment: fragments.join(", "),
            hue: 268,
            source: item.title,
          });
        }

        result.templates.push({
          id: `mp:${item.slug}`,
          name: item.title,
          category: "Templates",
          prompt: template.prompt,
          negativePrompt:
            typeof template.negativePrompt === "string"
              ? template.negativePrompt
              : undefined,
          presetIds: fragments.length > 0 ? [styleId] : [],
          source: item.title,
        });
        break;
      }

      case "CHARACTER": {
        const character = payload.character;
        if (!isRecord(character) || typeof character.anchor !== "string") break;

        result.characters.push({
          id: `mp:${item.slug}`,
          name: item.title,
          anchor: character.anchor,
          traits: Array.isArray(character.traits)
            ? character.traits.filter(
                (trait): trait is string => typeof trait === "string",
              )
            : [],
          seed: typeof character.seed === "number" ? character.seed : undefined,
          source: item.title,
        });
        break;
      }

      default:
        // Installed, catalogued, and nothing in the composer can use it yet.
        // Listed rather than dropped, so somebody who downloaded a voice pack
        // can see it is there and waiting rather than assume it failed.
        result.waiting.push({
          slug: item.slug,
          title: item.title,
          kind: item.kind,
        });
    }
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
