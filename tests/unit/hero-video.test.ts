import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  HERO_MEDIA,
  shouldPlayVideo,
} from "@/features/marketing/components/hero-media";

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

const file = (url: string) => url.replace("/marketing/", "");
const kb = (name: string) => statSync(resolve(MARKETING, name)).size / 1024;

const WEBM = file(HERO_MEDIA.webm);
const MP4 = file(HERO_MEDIA.mp4);
const POSTER = file(HERO_MEDIA.poster);
const POSTER_MOBILE = file(HERO_MEDIA.posterMobile);

describe("hero media ships within budget", () => {
  it("has all four assets", () => {
    for (const file of [WEBM, MP4, POSTER, POSTER_MOBILE]) {
      expect(existsSync(resolve(MARKETING, file)), file).toBe(true);
    }
  });

  it("keeps each asset inside its size budget", () => {
    // Budgets from the sprint brief. A regression here is somebody re-encoding
    // at a higher bitrate without noticing what it costs a phone.
    expect(kb(WEBM), "webm").toBeLessThanOrEqual(1.5 * 1024);
    expect(kb(MP4), "mp4").toBeLessThanOrEqual(2 * 1024);
    expect(kb(POSTER), "poster").toBeLessThanOrEqual(300);
    expect(kb(POSTER_MOBILE), "mobile poster").toBeLessThanOrEqual(180);
  });

  it("prefers the smaller codec first", () => {
    // Only matters if WebM is actually the smaller file; ordering it first
    // while it is larger would be a pessimisation dressed as an optimisation.
    expect(kb(WEBM)).toBeLessThan(kb(MP4));
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
    const mp4 = readFileSync(resolve(MARKETING, MP4));
    expect(mp4.includes(Buffer.from("mp4a")), "mp4 has audio").toBe(false);

    const webm = readFileSync(resolve(MARKETING, WEBM));
    expect(
      webm.includes(Buffer.from("A_OPUS")) ||
        webm.includes(Buffer.from("A_VORBIS")),
      "webm has audio",
    ).toBe(false);
  });

  it("ships real WebP posters", () => {
    for (const name of [POSTER, POSTER_MOBILE]) {
      const data = readFileSync(resolve(MARKETING, name));
      expect(data.subarray(0, 4).toString(), name).toBe("RIFF");
      expect(data.subarray(8, 12).toString(), name).toBe("WEBP");
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
    for (const name of [WEBM, MP4]) {
      expect(kb(name), name).toBeLessThan(10 * 1024);
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
    const webm = code.indexOf("HERO_MEDIA.webm");
    const mp4 = code.indexOf("HERO_MEDIA.mp4");
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
    const landing = readFileSync(
      resolve(ROOT, "features/marketing/components/landing.tsx"),
      "utf8",
    );
    expect(landing.match(/<Hero \/>/g)).toHaveLength(1);

    for (const route of [
      "app/(marketing)/page.tsx",
      "app/(marketing)/es/page.tsx",
    ]) {
      const source = readFileSync(resolve(ROOT, route), "utf8");
      expect(source, route).toMatch(/<Landing/);
      expect(source, route).not.toMatch(/hero\.[0-9a-f]{10}\.(webm|mp4)/);
    }
  });

  it("names the media in exactly one module", () => {
    // Filenames live in `hero-media.ts` alone, so a re-encode touches one line
    // and nothing can drift out of sync with what is on disk.
    const owners = [
      "features/marketing/components/hero-video.tsx",
      "features/marketing/components/hero.tsx",
      "features/marketing/components/landing.tsx",
    ].filter((path) =>
      /hero\.[0-9a-f]{10}\.(webm|mp4)/.test(
        readFileSync(resolve(ROOT, path), "utf8"),
      ),
    );
    expect(owners).toHaveLength(0);
  });

  it("references no obsolete unhashed filename", () => {
    for (const path of [
      "features/marketing/components/hero-video.tsx",
      "features/marketing/components/hero-media.ts",
      "features/marketing/components/landing.tsx",
      "styles/globals.css",
    ]) {
      const source = readFileSync(resolve(ROOT, path), "utf8");
      // Every shipped name must carry a content hash; a bare one would defeat
      // the immutable cache header.
      const bare = source.match(
        /marketing\/hero[a-z-]*\.(?:webm|mp4|webp)(?![0-9a-f])/g,
      );
      expect(bare, path).toBeNull();
    }
  });

  it("has every referenced file on disk", () => {
    for (const url of Object.values(HERO_MEDIA)) {
      expect(existsSync(resolve(MARKETING, file(url))), url).toBe(true);
    }
  });
});

describe("playback eligibility", () => {
  const desktop = {
    reducedMotion: false,
    saveData: false,
    effectiveType: "4g",
    viewportWidth: 1440,
    hardwareConcurrency: 8,
    deviceMemory: 8,
  };

  it("plays on a normal desktop", () => {
    expect(shouldPlayVideo(desktop)).toBe(true);
  });

  it("is poster-only on mobile widths", () => {
    expect(shouldPlayVideo({ ...desktop, viewportWidth: 375 })).toBe(false);
    expect(shouldPlayVideo({ ...desktop, viewportWidth: 767 })).toBe(false);
    expect(shouldPlayVideo({ ...desktop, viewportWidth: 768 })).toBe(true);
  });

  it("is poster-only under reduced motion", () => {
    expect(shouldPlayVideo({ ...desktop, reducedMotion: true })).toBe(false);
  });

  it("is poster-only under Save-Data", () => {
    expect(shouldPlayVideo({ ...desktop, saveData: true })).toBe(false);
  });

  it("is poster-only on 2G-class connections", () => {
    for (const effectiveType of ["slow-2g", "2g"]) {
      expect(shouldPlayVideo({ ...desktop, effectiveType })).toBe(false);
    }
    // 3G is slow but workable for 1.2 MB; it is not excluded.
    expect(shouldPlayVideo({ ...desktop, effectiveType: "3g" })).toBe(true);
  });

  it("is poster-only on low-end hardware", () => {
    expect(shouldPlayVideo({ ...desktop, hardwareConcurrency: 2 })).toBe(false);
    expect(shouldPlayVideo({ ...desktop, deviceMemory: 2 })).toBe(false);
    // 4 cores / 4 GB is an ordinary machine and must not be excluded.
    expect(
      shouldPlayVideo({ ...desktop, hardwareConcurrency: 4, deviceMemory: 4 }),
    ).toBe(true);
  });

  it("treats missing capability hints as capable", () => {
    // `deviceMemory` is absent in Safari and Firefox. Reading absence as
    // low-end would deny the video to most of the non-Chrome web.
    expect(
      shouldPlayVideo({
        reducedMotion: false,
        saveData: false,
        viewportWidth: 1440,
      }),
    ).toBe(true);
  });
});

describe("viewport gating and recovery", () => {
  it("waits for the hero to be near the viewport", () => {
    expect(code).toMatch(/IntersectionObserver/);
    expect(code).toMatch(/rootMargin/);
    // Sources only exist once both conditions hold.
    expect(code).toMatch(/eligible === true && near/);
  });

  it("pauses when hidden and when scrolled away", () => {
    expect(code).toMatch(/visibilitychange/);
    expect(code).toMatch(/document\.hidden/);
    expect(code).toMatch(/if \(video && !near\) video\.pause\(\)/);
  });

  it("offers an accessible control when autoplay is refused", () => {
    expect(code).toMatch(/autoplayBlocked/);
    expect(code).toMatch(/Play animation/);
    // The wrapper disables pointer events; the control re-enables its own.
    expect(code).toMatch(/pointer-events-auto/);
    expect(code).toMatch(/aria-hidden=\{false\}/);
  });

  it("keeps the control clear of the headline and CTAs", () => {
    // Pinned to the bottom-right of the hero, never over the copy.
    expect(code).toMatch(/right-4 bottom-4|bottom-4 right-4/);
  });

  it("decides nothing during render", () => {
    expect(code).toMatch(/useState<boolean \| null>\(null\)/);
    expect(code).not.toMatch(/useState\(\s*shouldPlayVideo/);
  });
});
