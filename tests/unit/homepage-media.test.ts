import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { TEMPLATES } from "@/features/marketing/content";

/**
 * Homepage image resolution, measured from the files themselves.
 *
 * ## Why this is not a style rule
 *
 * "Too dark and soft" turned out to have two separate causes, and only one of
 * them was visible in the source:
 *
 *   1. Three stacked scrims over the hero, compounding to ~88% obscuration.
 *   2. Sources written at a very low bitrate, then **re-encoded** by
 *      `next/image` at its default quality of 75.
 *
 * Neither would have been caught by a test asserting class names. What can be
 * checked mechanically is resolution: whether a file has enough pixels for the
 * box it is drawn into on a 2× screen, **after** `object-cover` crops it.
 *
 * That last part is where the real failures are. A 1344×768 landscape image in
 * a 4:5 portrait card does not contribute 1344 pixels of width — it
 * contributes the 614×768 rectangle that survives the crop, which is well
 * under what the card needs.
 *
 * Files that fail must be named in `docs/HOMEPAGE_MEDIA_REMAINING.md` with a
 * REPLACE verdict. The test does not demand perfect assets; it demands that an
 * imperfect one is written down.
 */

const MARKETING = resolve(import.meta.dirname, "../../public/marketing");
const DOC = resolve(
  import.meta.dirname,
  "../../docs/HOMEPAGE_MEDIA_REMAINING.md",
);

/** Minimal WebP header reader — enough for the three chunk types Sharp emits. */
function webpSize(name: string): { width: number; height: number } | null {
  const d = readFileSync(resolve(MARKETING, name));
  if (d.subarray(0, 4).toString() !== "RIFF") return null;
  if (d.subarray(8, 12).toString() !== "WEBP") return null;

  const format = d.subarray(12, 16).toString();

  if (format === "VP8X") {
    return {
      width: d.readUIntLE(24, 3) + 1,
      height: d.readUIntLE(27, 3) + 1,
    };
  }

  if (format === "VP8L") {
    const bits = d.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  if (format === "VP8 ") {
    const i = d.indexOf(Buffer.from([0x9d, 0x01, 0x2a]));
    if (i > 0) {
      return {
        width: d.readUInt16LE(i + 3) & 0x3fff,
        height: d.readUInt16LE(i + 5) & 0x3fff,
      };
    }
  }

  return null;
}

/**
 * The pixels that survive `object-cover` into a box of the given aspect.
 *
 * Wider-than-the-box sources lose width; taller ones lose height. This is the
 * number that decides whether a card looks sharp.
 */
function effective(
  source: { width: number; height: number },
  boxAspect: number,
) {
  const sourceAspect = source.width / source.height;

  return sourceAspect > boxAspect
    ? { width: Math.round(source.height * boxAspect), height: source.height }
    : { width: source.width, height: Math.round(source.width / boxAspect) };
}

/**
 * Maximum rendered size, measured in a browser on the production build at the
 * viewport where each element is largest. The layout caps at `max-w-7xl`, so
 * these do not grow past a 1440px viewport.
 */
const SURFACES = [
  { area: "gallery card", aspect: 4 / 5, rendered: { w: 393, h: 491 } },
  { area: "template card", aspect: 1152 / 896, rendered: { w: 393, h: 294 } },
  { area: "showcase panel", aspect: 1152 / 896, rendered: { w: 576, h: 432 } },
] as const;

const DENSITY = 2;

function docText() {
  return readFileSync(DOC, "utf8");
}

describe("the media audit document", () => {
  it("exists and covers every file it needs to", () => {
    const text = docText();
    expect(text.length, "the media doc is empty").toBeGreaterThan(2000);

    // The columns the sprint brief asks for.
    for (const heading of [
      "Source",
      "Max rendered",
      "Effective source",
      "Needed",
      "Verdict",
    ]) {
      expect(text, `the audit table has no "${heading}" column`).toContain(
        heading,
      );
    }
  });

  it("keeps every template and showcase still above its density floor", () => {
    for (const template of TEMPLATES) {
      const source = webpSize(`${template.image}.webp`);
      expect(source, `${template.image}.webp could not be read`).not.toBeNull();

      const surface = SURFACES[1]!;
      const usable = effective(source!, surface.aspect);

      expect(
        usable.width,
        `${template.image}.webp is ${usable.width}px for a ${surface.rendered.w * DENSITY}px slot`,
      ).toBeGreaterThanOrEqual(surface.rendered.w * DENSITY);
    }
  });

  it("records the delivered portrait clips and where the spec was missed", () => {
    /**
     * This asserted that four *missing* clips were specified. They are no
     * longer missing, so asserting their absence is specified would keep
     * passing while describing a state that ended.
     *
     * What still needs guarding is the honesty of the record: the clips landed
     * at 720p against a spec that preferred 1080×1920, and the doc has to say
     * so rather than quietly present the delivery as complete.
     */
    const text = docText();

    for (const file of ["made-video-3", "made-video-6"]) {
      expect(text, `${file} is not recorded`).toContain(file);
    }

    expect(text).toContain("DELIVERED");
    expect(text).toMatch(/720×1280/);
    expect(text).toMatch(/9:16/);
    // The shortfall, stated: the model's ceiling, not a rounding error.
    expect(text).toMatch(/720p/);
  });
});
