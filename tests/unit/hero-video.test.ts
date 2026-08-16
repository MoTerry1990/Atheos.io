import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The hero background loop, asserted against the shipped files and the source.
 *
 * ## Why file bytes and not a rendered component
 *
 * The things that actually break here are not render output. They are: a source
 * order that makes every visitor download both codecs, an audio track nobody
 * noticed, an asset that quietly grew past its budget, and a 76 MB master
 * getting committed. None of those show up in JSDOM, and all of them show up in
 * the file itself.
 *
 * Container parsing is done by signature rather than by shelling out to
 * ffprobe: the test suite must run on a machine without ffmpeg installed.
 */

const ROOT = resolve(import.meta.dirname, "../..");
const MARKETING = resolve(ROOT, "public/marketing");
const hero = readFileSync(
  resolve(ROOT, "features/marketing/components/hero-video.tsx"),
  "utf8",
);

/** Source with comments stripped — the file documents what it no longer does. */
const code = hero
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

const kb = (name: string) => statSync(resolve(MARKETING, name)).size / 1024;

describe("hero media ships within budget", () => {
  it("has all four assets", () => {
    for (const file of [
      "hero.webm",
      "hero.mp4",
      "hero-poster.webp",
      "hero-poster-mobile.webp",
    ]) {
      expect(existsSync(resolve(MARKETING, file)), file).toBe(true);
    }
  });

  it("keeps each asset inside its size budget", () => {
    // Budgets from the sprint brief. A regression here is somebody re-encoding
    // at a higher bitrate without noticing what it costs a phone.
    expect(kb("hero.webm"), "webm").toBeLessThanOrEqual(3 * 1024);
    expect(kb("hero.mp4"), "mp4").toBeLessThanOrEqual(4 * 1024);
    expect(kb("hero-poster.webp"), "poster").toBeLessThanOrEqual(300);
    expect(kb("hero-poster-mobile.webp"), "mobile poster").toBeLessThanOrEqual(
      180,
    );
  });

  it("prefers the smaller codec first", () => {
    // Only matters if WebM is actually the smaller file; ordering it first
    // while it is larger would be a pessimisation dressed as an optimisation.
    expect(kb("hero.webm")).toBeLessThan(kb("hero.mp4"));
  });

  it("ships no audio track in either container", () => {
    /**
     * Absent, not muted. A muted track still costs bytes and still lets an
     * unmute control produce sound on a marketing page.
     *
     * MP4 carries an `mp4a` sample-entry box when it has AAC; WebM carries a
     * codec id beginning `A_`. Neither appears in a stripped file. The 4K
     * source *does* have AAC, so this is a live check, not a formality.
     */
    const mp4 = readFileSync(resolve(MARKETING, "hero.mp4"));
    expect(mp4.includes(Buffer.from("mp4a")), "mp4 has audio").toBe(false);

    const webm = readFileSync(resolve(MARKETING, "hero.webm"));
    expect(
      webm.includes(Buffer.from("A_OPUS")) ||
        webm.includes(Buffer.from("A_VORBIS")),
      "webm has audio",
    ).toBe(false);
  });

  it("ships real WebP posters", () => {
    for (const file of ["hero-poster.webp", "hero-poster-mobile.webp"]) {
      const data = readFileSync(resolve(MARKETING, file));
      expect(data.subarray(0, 4).toString(), file).toBe("RIFF");
      expect(data.subarray(8, 12).toString(), file).toBe("WEBP");
    }
  });

  it("keeps the 4K master out of the repository", () => {
    /**
     * The source is 3840×2160 and 76 MB. Committing it would bloat every clone
     * forever and ship it to the CDN for nobody's benefit.
     */
    for (const stray of [
      "atheos_hero_4k_30s.mp4",
      "atheos-hero-source.mp4",
      "master.mp4",
      "loop-master.mp4",
    ]) {
      expect(existsSync(resolve(MARKETING, stray)), stray).toBe(false);
    }
    // Nothing in the shipped media directory is anywhere near master size.
    for (const file of ["hero.webm", "hero.mp4"]) {
      expect(kb(file), file).toBeLessThan(10 * 1024);
    }
  });
});

describe("hero video element behaviour", () => {
  it("is muted, looping, inline and autoplaying", () => {
    // `muted` and `playsInline` are both preconditions for autoplay being
    // permitted at all; `playsInline` also stops iOS taking it fullscreen.
    for (const attribute of ["muted", "loop", "playsInline", "autoPlay"]) {
      expect(code, attribute).toMatch(new RegExp(`\\b${attribute}\\b`));
    }
  });

  it("never renders playback controls", () => {
    expect(code).not.toMatch(/\bcontrols\b/);
  });

  it("does not preload the video ahead of the poster", () => {
    expect(code).toMatch(/preload="none"/);
  });

  it("offers WebM before MP4", () => {
    const webm = code.indexOf("hero.webm");
    const mp4 = code.indexOf("hero.mp4");
    expect(webm).toBeGreaterThan(-1);
    expect(mp4).toBeGreaterThan(-1);
    // The browser takes the first source it can play and fetches only that
    // one, so ordering is the whole negotiation.
    expect(webm).toBeLessThan(mp4);
  });

  it("is hidden from assistive technology", () => {
    // Purely decorative: there is nothing here for a screen reader to convey.
    expect(code).toMatch(/aria-hidden/);
  });

  it("covers its box without distorting the frame", () => {
    expect(code).toMatch(/object-cover/);
  });

  it("renders the poster whatever happens to the video", () => {
    // The poster is a sibling element, not the `poster` attribute, so it stays
    // painted underneath rather than being swapped out in one frame.
    expect(code).toMatch(/hero-poster/);
  });
});

describe("the visitor's preferences win", () => {
  it("renders poster-only under prefers-reduced-motion", () => {
    expect(code).toMatch(/prefers-reduced-motion: reduce/);
    // The video element is conditional on the decision, not merely paused.
    expect(code).toMatch(/allowed \?/);
  });

  it("renders poster-only when Save-Data is on", () => {
    expect(code).toMatch(/saveData/);
  });

  it("renders poster-only on 2G-class connections", () => {
    expect(code).toMatch(/effectiveType/);
    expect(code).toMatch(/slow-2g/);
  });

  it("starts disallowed so the server and client markup agree", () => {
    /**
     * `useState(false)` plus a decision in an effect. Reading `matchMedia` or
     * `navigator.connection` during render would produce different markup on
     * the server and the client, which is a hydration error.
     */
    expect(code).toMatch(/useState\(false\)/);
    expect(code).not.toMatch(/useState\(\s*!?\s*window/);
  });

  it("pauses in a hidden tab", () => {
    expect(code).toMatch(/visibilitychange/);
    expect(code).toMatch(/document\.hidden/);
    expect(code).toMatch(/video\.pause\(\)/);
  });

  it("removes its listeners on unmount", () => {
    // Two listeners are added; both must come back off, or a remounting hero
    // leaks one per mount.
    expect(code).toMatch(/removeEventListener\("change"/);
    expect(code).toMatch(/removeEventListener\("visibilitychange"/);
  });
});

describe("English and Spanish share one asset", () => {
  it("renders the hero from a single shared component", () => {
    /**
     * `/` and `/es` both compose `Landing`, which renders one `Hero`. If the
     * two routes ever grew separate hero markup they would also grow separate
     * media, and a visitor switching language would download the loop twice.
     */
    const landing = readFileSync(
      resolve(ROOT, "features/marketing/components/landing.tsx"),
      "utf8",
    );
    expect(landing).toMatch(/<Hero \/>/);
    expect(landing.match(/<Hero \/>/g)).toHaveLength(1);

    for (const route of [
      "app/(marketing)/page.tsx",
      "app/(marketing)/es/page.tsx",
    ]) {
      const source = readFileSync(resolve(ROOT, route), "utf8");
      expect(source, route).toMatch(/<Landing/);
      // Neither route names media of its own.
      expect(source, route).not.toMatch(/hero\.(webm|mp4)/);
    }
  });

  it("names the loop in exactly one component", () => {
    const hits = ["hero.webm", "hero.mp4"].map((file) =>
      [
        "features/marketing/components/hero-video.tsx",
        "features/marketing/components/hero.tsx",
        "features/marketing/components/landing.tsx",
      ].filter((path) =>
        readFileSync(resolve(ROOT, path), "utf8").includes(file),
      ),
    );
    for (const owners of hits) expect(owners).toHaveLength(1);
  });
});
