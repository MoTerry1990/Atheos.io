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

const MP4 = file(HERO_MEDIA.mp4);
const POSTER = file(HERO_MEDIA.poster);
const POSTER_MOBILE = file(HERO_MEDIA.posterMobile);

describe("hero media ships within budget", () => {
  it("has every asset it names", () => {
    for (const file of [MP4, POSTER, POSTER_MOBILE]) {
      expect(existsSync(resolve(MARKETING, file)), file).toBe(true);
    }
  });

  it("keeps each asset inside its size budget", () => {
    /**
     * The video budget was **2 MB and is now 7**, which is a real regression
     * in weight and is recorded rather than quietly widened.
     *
     * The previous hero was 1080p of comparatively flat content. This one is
     * sparkling water and foliage at 1920x1080 — close to the worst case for
     * any codec. Measured against the master: CRF 24 is 18.4 MB, CRF 27 is
     * 11.1 MB, CRF 30 is 6.1 MB, and a *shorter* cut at higher quality came
     * out heavier still (7.6 MB for five seconds), because the seconds worth
     * keeping are the expensive ones.
     *
     * 6.1 MB is therefore the floor for this clip at full duration and
     * resolution, not a number somebody failed to optimise. It is affordable
     * only because the poster is the LCP element and `preload="none"` keeps
     * the video off the critical path — if either of those changes, this
     * budget is wrong again.
     */
    expect(kb(MP4), "mp4").toBeLessThanOrEqual(7 * 1024);
    expect(kb(POSTER), "poster").toBeLessThanOrEqual(300);
    expect(kb(POSTER_MOBILE), "mobile poster").toBeLessThanOrEqual(180);
  });

  it("ships the audio track the hero now offers", () => {
    /**
     * **This reverses an earlier decision, deliberately.**
     *
     * The rule used to be that the hero carried *no* audio track at all —
     * "absent, not muted", on the reasoning that a muted track still costs
     * bytes and still lets an unmute control produce sound on a marketing
     * page. That was correct while there was no unmute control and nothing
     * worth hearing.
     *
     * There is now both: the source has a real AAC stereo track, and the hero
     * offers a "Hear audio" button. Shipping a silent file behind a button
     * that promises sound would be the worse failure.
     *
     * `mp4a` is the AAC sample-entry box. Its presence is what earns the
     * "Native audio" label on the showcase card.
     */
    const mp4 = readFileSync(resolve(MARKETING, MP4));
    expect(mp4.includes(Buffer.from("mp4a")), "mp4 carries AAC").toBe(true);
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
    /**
     * The current master is 44 MB and lives in `media-source/`, which is
     * gitignored. Nothing in the *shipped* directory may approach it — the
     * published hero is 6.1 MB, so 10 MB still leaves the check meaningful
     * while allowing the encode this clip actually needs.
     */
    expect(kb(MP4), MP4).toBeLessThan(10 * 1024);
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

  it("ships one source, because the alternative encode lost", () => {
    /**
     * WebM used to come first and was genuinely smaller. On this clip every
     * VP9 encode came out heavier than H.264 at comparable quality — 22 MB
     * against 6.1 MB at the closest match. The browser takes the first source
     * it can play, so shipping a losing WebM would guarantee the larger
     * download.
     */
    expect(code).toMatch(/HERO_MEDIA\.mp4/);
    expect(code).not.toMatch(/HERO_MEDIA\.webm/);
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

  it("puts nothing coloured over the footage", () => {
    /**
     * The hero exists to show what the product produces, and it was tinting
     * the evidence: a `bg-gradient-brand-subtle` wash at 30% inside the video
     * layer, plus `AnimatedBackground` rendered *deliberately* on top of it —
     * a violet radial at 15% and a cyan one at 90%, with three blurred colour
     * orbs. A red car on a blue sea arrived mauve on the left and cyan on the
     * right.
     *
     * Every mechanism that could reintroduce it is checked, not just the two
     * that were there: a `filter` or a `mix-blend-mode` would tint the frame
     * just as effectively and would not look like a gradient in review.
     */
    for (const banned of [
      /gradient-brand/,
      /bg-aurora/,
      /AnimatedBackground/,
      /mix-blend/,
      /\bfilter:/,
      /saturate|hue-rotate|sepia/,
    ]) {
      expect(code, `${banned} is back over the hero video`).not.toMatch(banned);
      expect(
        hero.replace(/\/\*[\s\S]*?\*\//g, ""),
        `${banned} is back in the hero section`,
      ).not.toMatch(banned);
    }
  });

  it("scrims with black alone, and not evenly", () => {
    /**
     * The replacement has to stay a *gradient*. A flat `bg-black/40` would
     * satisfy "no colour" and still be the uniformly dark layer the old one
     * was — the brief's actual complaint was two separate things, a tint and
     * a wash, and fixing only the tint would leave the footage muddy.
     */
    const css = readFileSync(resolve(ROOT, "styles/globals.css"), "utf8");
    const rule = css.slice(
      css.indexOf(".hero-scrim"),
      css.indexOf(".hero-poster"),
    );

    expect(code).toMatch(/hero-scrim/);
    expect(rule).toMatch(/linear-gradient/);
    // Pure black at varying alpha. Any colour function with real chroma here
    // would be a tint by another name.
    expect(rule).not.toMatch(/oklch\(\s*0?\.\d+\s+0\.[1-9]/);
    expect(rule).not.toMatch(/var\(--color-brand|var\(--color-info/);

    // Transparent at the top, so the sky and water are the model's colours.
    expect(rule).toMatch(/rgb\(0 0 0 \/ 0\) 0%/);

    // And genuinely graded: at least four stops, rising.
    const alphas = [...rule.matchAll(/rgb\(0 0 0 \/ ([\d.]+)\)/g)].map((m) =>
      Number(m[1]),
    );
    expect(alphas.length).toBeGreaterThanOrEqual(4);
    expect(alphas).toEqual([...alphas].sort((a, b) => a - b));
    // Nothing heavy enough to crush the frame it sits on.
    expect(Math.max(...alphas)).toBeLessThanOrEqual(0.5);
  });

  it("paints the poster of the video it is actually playing", () => {
    /**
     * The gap this closes, which was live until it was found.
     *
     * The poster is a CSS background and an LCP preload, so neither goes
     * through `HERO_MEDIA`. When the hero clip was replaced, `hero-media.ts`
     * was updated and those two were not — the page preloaded and painted a
     * still from the *previous* video, then cut to the new one. Every existing
     * test passed: the video assertions match only `hero.<hash>.mp4`, and the
     * unhashed-name rule rejects a bare filename, not a hashed wrong one.
     *
     * So the check is on the poster names specifically, and it is a whole-file
     * sweep rather than a list of the two places that were wrong.
     */
    const posters = new Set([HERO_MEDIA.poster, HERO_MEDIA.posterMobile]);

    for (const path of [
      "styles/globals.css",
      "features/marketing/components/landing.tsx",
      "features/marketing/components/hero-video.tsx",
      "features/marketing/components/hero.tsx",
    ]) {
      const source = readFileSync(resolve(ROOT, path), "utf8");
      const referenced =
        source.match(/\/marketing\/hero-poster[a-z-]*\.[0-9a-f]{10}\.webp/g) ??
        [];

      for (const url of referenced) {
        expect(
          posters.has(url as (typeof HERO_MEDIA)["poster"]),
          `${path} paints ${url}, which is not the current hero poster`,
        ).toBe(true);
      }
    }
  });

  it("preloads exactly what the stylesheet will request", () => {
    // Two files for one painted image is the failure mode a mismatched
    // preload produces, and it is invisible unless the URLs are compared.
    const css = readFileSync(resolve(ROOT, "styles/globals.css"), "utf8");
    const landing = readFileSync(
      resolve(ROOT, "features/marketing/components/landing.tsx"),
      "utf8",
    );

    expect(css).toContain(HERO_MEDIA.poster);
    expect(css).toContain(HERO_MEDIA.posterMobile);
    // Built from `HERO_MEDIA`, not written out, so it cannot drift at all.
    expect(landing).toMatch(/imageSrcSet=\{`\$\{HERO_MEDIA\.posterMobile\}/);
    expect(landing).toMatch(/\$\{HERO_MEDIA\.poster\} 1920w`\}/);
  });

  it("has every referenced file on disk", () => {
    // `HERO_MEDIA` also carries duration and an audio flag now, so only the
    // string values name files.
    for (const url of Object.values(HERO_MEDIA)) {
      if (typeof url !== "string") continue;
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

  it("offers persistent playback controls, not only a fallback", () => {
    /**
     * This used to assert a single "Play animation" button shown *only* when
     * autoplay had been refused. The hero now offers Pause/Play at all times,
     * because a background video a visitor cannot stop is a background video
     * some visitors cannot use.
     */
    expect(code).toMatch(/Pause background video/);
    expect(code).toMatch(/Play background video/);

    /**
     * This used to require `pointer-events-auto` and `aria-hidden={false}` on
     * the control row. Both were the symptoms of the row being a child of the
     * decorative `aria-hidden` wrapper — and `aria-hidden` on an ancestor
     * cannot be cleared by a descendant, so asserting `aria-hidden={false}`
     * was asserting a no-op. The row is now a sibling of the decoration, so
     * neither is needed, and `aria-hidden={false}` must *not* come back:
     * writing it again would mean the row had been moved back inside.
     */
    expect(code).not.toMatch(/aria-hidden=\{false\}/);
  });

  it("offers audio, and never starts it by itself", () => {
    /**
     * The clip has a real AAC track now. Three things have to hold at once:
     * the element is `muted` in markup so autoplay is permitted, the only way
     * to unmute is a press, and the control's accessible name says which state
     * it is currently in — "Hear audio" alone never tells a screen-reader user
     * whether sound is already on.
     */
    expect(code).toMatch(/\bmuted\b/);
    expect(code).toMatch(/Hear audio — currently muted/);
    expect(code).toMatch(/Mute audio — currently on/);
    expect(code).toMatch(/aria-pressed=\{!muted\}/);

    // Nothing may unmute outside a click handler.
    const autoUnmute = /muted\s*=\s*false(?![^;]*onClick)/.test(
      code.replace(/onClick=\{[\s\S]*?\}\}/g, ""),
    );
    expect(autoUnmute, "unmutes without a press").toBe(false);
  });

  it("stops sound and playback when the tab is hidden", () => {
    // Audio must not follow somebody to another tab after they turned it on.
    expect(code).toMatch(/visibilitychange/);
    expect(code).toMatch(/document\.hidden/);
  });

  it("carries the disclosure the transcode could not", () => {
    /**
     * The master's C2PA manifest does not survive re-encoding, so the claim
     * moves to the page. Short by design — a long warning over a hero reads as
     * an apology — with the detail one link away.
     */
    expect(code).toMatch(/AI-generated /);
    expect(code).toMatch(/Web-optimized preview/);
    expect(code).toMatch(/\/content-details/);

    /**
     * The noun follows what is on screen — "video" when one is playing,
     * "image" when only the poster is. A hard-coded "AI-generated video" was
     * the previous text and it was wrong for every visitor who never gets a
     * video, which is the same set of visitors the label was missing from
     * entirely. Whether it actually renders in that state is asserted against
     * a real DOM in `tests/components/hero-disclosure.test.tsx`.
     */
    expect(code).toMatch(/showVideo \? "video" : "image"/);
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
