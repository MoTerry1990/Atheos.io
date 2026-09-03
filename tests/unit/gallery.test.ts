import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { GALLERY } from "@/features/marketing/gallery.generated";

/**
 * The "Made with Atheos" gallery, checked against the files and the source.
 *
 * ## What was actually wrong
 *
 * The section shipped six cards, two of them video, and a production audit
 * found the same six assets that had been there for several sprints. Nothing
 * in the suite noticed, because nothing in the suite asserted a *size* — the
 * old tests checked that a video card had a clip and that posters cleared a
 * density floor, both of which six cards satisfied perfectly.
 *
 * So the first thing here is a count. It is the claim the section makes, and
 * an uncounted claim is the one that quietly stops being true.
 *
 * ## Why the file bytes and not a rendered component
 *
 * The failures that matter are a manifest naming a poster nobody built, a
 * second card carrying the first card's prompt, a legacy path surviving in one
 * of five places, and a video that autoplays. None of those show up in JSDOM,
 * and all of them show up in the manifest or the source.
 */

const ROOT = resolve(import.meta.dirname, "..", "..");
const PUBLIC = resolve(ROOT, "public");

const source = (relative: string) =>
  readFileSync(resolve(ROOT, relative), "utf8");

const gallery = source("features/marketing/components/made-with-atheos.tsx");

/** Source with comments stripped — the file documents what it no longer does. */
const code = gallery
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

const images = GALLERY.filter((item) => item.kind === "image");
const videos = GALLERY.filter((item) => item.kind === "video");

/**
 * Every legacy path the sprint was asked to stop rendering.
 *
 * Named individually rather than as a pattern: the point is that these exact
 * files no longer reach a visitor, and a pattern would also match their
 * replacements.
 */
const RETIRED = [
  "showcase-image",
  "made-video-3",
  "made-video-4",
  "gallery-2",
  "gallery-4",
  "gallery-5",
  "gallery-8",
  "template-3",
  "template-5",
  "feature-library",
];

/** Everything a visitor's browser is handed on the marketing routes. */
const HOMEPAGE_SOURCES = [
  "features/marketing/content.ts",
  "features/marketing/gallery.generated.ts",
  "features/marketing/components/made-with-atheos.tsx",
  "features/marketing/components/landing.tsx",
  "features/marketing/components/templates.tsx",
  "features/marketing/components/features.tsx",
  "features/marketing/components/ai-showcase.tsx",
  "features/marketing/components/hero-media.ts",
  "app/(marketing)/page.tsx",
  "app/(marketing)/es/page.tsx",
];

describe("the gallery is the size it claims to be", () => {
  it("carries at least thirty creations", () => {
    expect(GALLERY.length).toBeGreaterThanOrEqual(30);
  });

  it("is at least eighteen images and twelve videos", () => {
    expect(images.length, "images").toBeGreaterThanOrEqual(18);
    expect(videos.length, "videos").toBeGreaterThanOrEqual(12);
  });

  it("counts a video once, not twice", () => {
    /**
     * A video card has a poster *and* a clip. Counting the poster as a
     * creation of its own would let twelve videos look like twenty-four
     * cards, which is the easiest possible way to fake the number above.
     *
     * The manifest makes it structurally impossible — a poster is a field on
     * an entry, never an entry — and this asserts that shape rather than
     * trusting it.
     */
    for (const item of GALLERY) {
      expect(
        GALLERY.filter((other) => other.poster === item.poster),
        `${item.poster} is the poster of more than one card`,
      ).toHaveLength(1);
    }

    const posters = new Set(GALLERY.map((item) => item.poster));
    expect(posters.size).toBe(GALLERY.length);
  });
});

describe("nothing in it repeats", () => {
  it("gives every card its own id", () => {
    const ids = new Set(GALLERY.map((item) => item.id));
    expect(ids.size).toBe(GALLERY.length);
  });

  it("gives every card its own prompt", () => {
    // Two cards with one prompt is two views of one idea presented as two
    // creations, and it is what padding a gallery looks like.
    const prompts = new Set(GALLERY.map((item) => item.prompt.toLowerCase()));
    expect(prompts.size).toBe(GALLERY.length);
  });

  it("gives every card its own source file", () => {
    const sources = GALLERY.map((item) => item.src ?? item.poster);
    expect(new Set(sources).size).toBe(GALLERY.length);
  });

  it("derives every card from a different master", () => {
    /**
     * The check the other three cannot make. Two entries can carry different
     * ids, different prompts and different filenames while being the same
     * bytes re-encoded — a crop, or a copy under a new name. The master hash
     * is the only thing that catches it.
     */
    const masters = new Set(GALLERY.map((item) => item.masterSha256));
    expect(masters.size).toBe(GALLERY.length);
  });
});

describe("every file it names exists", () => {
  it("has a poster on disk with real content in it", () => {
    for (const item of GALLERY) {
      const file = resolve(PUBLIC, item.poster.replace(/^\//, ""));
      expect(existsSync(file), `${item.poster} is missing`).toBe(true);
      // A zero-byte or near-empty WebP is a failed encode that still passes an
      // existence check, and renders as the empty black card this gallery
      // replaced.
      expect(statSync(file).size, `${item.poster} is empty`).toBeGreaterThan(
        2000,
      );
    }
  });

  it("serves the poster at a size a retina card can use", () => {
    // `next/image` can only resize *down*. Handing it a 640 for a card that
    // paints 400 CSS px on a 2x screen means a permanently soft gallery.
    for (const item of GALLERY) {
      expect(item.poster, item.id).toMatch(/-1280\.[0-9a-f]{10}\.webp$/);
    }
  });

  it("has a clip for every video and none for an image", () => {
    for (const item of GALLERY) {
      if (item.kind === "video") {
        expect(item.src, `${item.id} claims video with no clip`).toBeTruthy();
        const file = resolve(PUBLIC, item.src!.replace(/^\//, ""));
        expect(existsSync(file), `${item.src} is missing`).toBe(true);
      } else {
        expect(item.src, `${item.id} is an image with a clip`).toBeUndefined();
      }
    }
  });

  it("knows the real shape of every master", () => {
    // The aspect box is built from these. A zero or a default would put the
    // card at the wrong height and shift everything under it when the poster
    // arrives.
    for (const item of GALLERY) {
      expect(item.width, `${item.id} width`).toBeGreaterThan(0);
      expect(item.height, `${item.id} height`).toBeGreaterThan(0);
    }
  });

  it("keeps every clip small enough to arrive after a click", () => {
    /**
     * These load on interaction, so they are not on the critical path — but
     * "after a click" still has to feel immediate on a phone. 4 MB is about
     * two seconds on a good 4G connection.
     */
    for (const item of videos) {
      const bytes = statSync(
        resolve(PUBLIC, item.src!.replace(/^\//, "")),
      ).size;
      expect(
        bytes / 1024 / 1024,
        `${item.id} is ${(bytes / 1024 / 1024).toFixed(1)} MB`,
      ).toBeLessThan(4);
    }
  });
});

describe("the retired assets are gone from the page", () => {
  it("appears in no homepage source", () => {
    for (const file of HOMEPAGE_SOURCES) {
      const text = source(file);
      for (const asset of RETIRED) {
        expect(text, `${file} still references ${asset}`).not.toContain(asset);
      }
    }
  });

  it("appears nowhere in the gallery manifest", () => {
    const text = source("features/marketing/gallery.generated.ts");
    for (const asset of RETIRED) {
      expect(text).not.toContain(asset);
    }
  });
});

describe("only the hero autoplays", () => {
  it("never sets autoPlay on a gallery card", () => {
    /**
     * Thirty autoplaying videos is thirty simultaneous decodes and, on a
     * phone, thirty downloads nobody asked for. The hero is the single
     * deliberate exception on the site and it lives in another file.
     */
    expect(code).not.toMatch(/autoPlay/);
  });

  it("does not preload a clip", () => {
    expect(code).toMatch(/preload="none"/);
  });

  it("renders no source until the card has been interacted with", () => {
    /**
     * The distinction that matters, and the one the previous version got
     * wrong: it armed on *proximity to the viewport*, so scrolling past the
     * section put every clip in flight. It now arms on hover, focus or tap.
     */
    expect(code).toMatch(/\{armed \? <source/);
    expect(code).toMatch(/setArmed\(true\)/);
    expect(code).toMatch(/onMouseEnter=\{playable \? start : undefined\}/);
    expect(code).toMatch(/onClick=\{toggle\}/);
  });

  it("lets the element, not React state, decide what a click does", () => {
    /**
     * `active` is React's belief; `video.paused` is the fact.
     *
     * They were measured disagreeing on the built page — a card paused while
     * its button reported `aria-pressed="true"` — because the viewport
     * observer pauses the element directly rather than through `stop()`. A
     * click handler that branches on `active` inherits that staleness, so it
     * branches on the element.
     *
     * `onFocus={start}` and `onBlur={stop}` go with it: a second way to start
     * and stop the same video, racing the click handler on any pointer
     * interaction, and focus-to-play would start a preview for every card a
     * keyboard user tabs past.
     */
    expect(code).toMatch(/if \(video\.paused\) start\(\);/);
    expect(code).not.toMatch(/onFocus=\{start\}/);
    expect(code).not.toMatch(/onBlur=\{stop\}/);
    expect(code).not.toMatch(/active \? stop\(\) : start\(\)/);
  });

  it("keeps the button's state tied to the element", () => {
    // The observer, another card claiming playback and a refused autoplay all
    // pause the video without going through `stop()`. Without these the badge
    // would keep claiming it is playing.
    expect(code).toMatch(/onPlay=\{\(\) => setActive\(true\)\}/);
    expect(code).toMatch(/onPause=\{\(\) => setActive\(false\)\}/);
  });

  it("keeps one video playing at a time", () => {
    expect(code).toMatch(/playing\.current\.pause\(\)/);
  });

  it("stops a card that scrolls away", () => {
    expect(code).toMatch(/IntersectionObserver/);
    expect(code).toMatch(/video\.pause\(\)/);
  });
});

describe("nothing shifts and nothing loads early", () => {
  it("gives every card an explicit aspect ratio", () => {
    // Layout shift on a thirty-card grid is the difference between a CLS of
    // 0.02 and a CLS of 0.4.
    expect(code).toMatch(
      /aspectRatio: `\$\{item\.width\} \/ \$\{item\.height\}`/,
    );
  });

  it("lazy-loads everything below the first row", () => {
    expect(code).toMatch(/loading=\{eager \? "eager" : "lazy"\}/);
  });

  it("asks for a poster at the size the card renders", () => {
    // Without `sizes`, the browser assumes 100vw and fetches the widest
    // variant for a card painted at 400px on a three-column grid.
    expect(code).toMatch(/sizes="\(max-width: 640px\) 100vw/);
  });

  it("does not re-compress an already-optimised poster at q75", () => {
    // The posters are WebP already. `next/image` defaults to quality 75, and
    // compounded lossy compression is what soft marketing imagery is made of.
    expect(code).toMatch(/quality=\{90\}/);
  });

  it("warms the first posters before the section arrives", () => {
    // The brief: no empty black cards while posters load.
    expect(code).toMatch(/rootMargin: "600px"/);
    expect(code).toMatch(/setPrimed\(true\)/);
  });

  it("shows a surface, not black, behind a poster that has not painted", () => {
    expect(code).toMatch(/bg-surface-sunken/);
  });
});

describe("the card says what it is and what it will make", () => {
  it("labels every card with its media type", () => {
    expect(code).toMatch(/\{item\.kind\}/);
  });

  it("shows the prompt", () => {
    expect(code).toMatch(/\{item\.prompt\}/);
  });

  it("carries the prompt and the right modality into the studio", () => {
    expect(code).toMatch(/prompt=\$\{encodeURIComponent\(item\.prompt\)\}/);
    expect(code).toMatch(/modality=\$\{item\.modality\}/);
  });

  it("gives every card a modality that matches its kind", () => {
    for (const item of GALLERY) {
      expect(item.modality, item.id).toBe(
        item.kind === "video" ? "VIDEO" : "IMAGE",
      );
    }
  });

  it("offers a play control that names what it plays", () => {
    // "Play preview" on thirty buttons is thirty identically-named controls
    // in a screen reader's list.
    expect(code).toMatch(
      /aria-label=\{`\$\{playLabel\}: \$\{item\.prompt\}`\}/,
    );
  });
});

describe("the gallery names no vendor", () => {
  it("keeps provider identities out of the manifest", () => {
    /**
     * The product's promise is many vendors behind one interface. A card
     * captioned with the model that made it breaks that promise on the
     * marketing page, and it is also a pricing signal we do not owe anyone.
     */
    const text = source(
      "features/marketing/gallery.generated.ts",
    ).toLowerCase();
    for (const vendor of [
      "replicate",
      "google",
      "veo",
      "flux",
      "nano-banana",
      "gemini",
      "openai",
      "wan-2",
      "esrgan",
    ]) {
      expect(text, `the manifest names ${vendor}`).not.toContain(vendor);
    }
  });

  it("shows the subject rather than the model", () => {
    expect(code).toMatch(/\{item\.category\}/);
    expect(code).not.toMatch(/item\.model/);
  });
});

describe("building the gallery calls no provider", () => {
  it("reads the manifest rather than an API", () => {
    // This suite runs on every commit. If it could reach a provider it would
    // bill on every commit.
    expect(code).not.toMatch(/fetch\(/);
    expect(source("features/marketing/gallery.generated.ts")).not.toMatch(
      /https?:\/\//,
    );
  });

  it("keeps generation in a script that is run by hand", () => {
    /**
     * `scripts/generate-gallery-assets.ts` is the only thing that spends
     * money, it is never imported by the app, and it refuses to start when
     * the estimate exceeds its cap.
     */
    const script = source("scripts/generate-gallery-assets.ts");
    expect(script).toMatch(/--cap=/);
    expect(script).toMatch(
      /exceeds the \$\$\{cap\.toFixed\(2\)\} cap|exceeds the/,
    );

    for (const file of HOMEPAGE_SOURCES) {
      expect(source(file), `${file} imports the generator`).not.toContain(
        "generate-gallery-assets",
      );
    }
  });
});
