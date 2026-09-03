import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { SHOWCASE } from "@/features/marketing/content";
import { EN } from "@/features/marketing/i18n/en";
import { ES } from "@/features/marketing/i18n/es";

/**
 * The three homepage showcase tabs.
 *
 * ## What is actually at risk here
 *
 * Not layout. Two things, both of which are claims rather than code:
 *
 *   1. **Audio described as music.** The panel headline said "Music and sound
 *      effects" while `replicate/music` is `BLOCKED_COMMERCIAL` under
 *      CC-BY-NC — an advertised capability the product cannot legally provide.
 *      It shipped that way, above a working audio player, until this test
 *      existed.
 *   2. **Sound design described as native audio.** The video's picture is model
 *      output and its sound is a separately generated Foley bed mixed in
 *      locally. No commercially approved model in the catalogue generates
 *      audio at all, so "native audio" would be false on the face of it.
 *
 * The rest checks that the files the tabs point at exist and contain what they
 * claim — an audio tab whose file is silent is worse than no audio tab.
 */

const ROOT = resolve(import.meta.dirname, "..", "..");
const PUBLIC = resolve(ROOT, "public");

const media = (url: string) => resolve(PUBLIC, url.replace(/^\//, ""));
const component = readFileSync(
  resolve(ROOT, "features/marketing/components/showcase-media.tsx"),
  "utf8",
);

/**
 * The component with its comments removed.
 *
 * The behavioural assertions have to read this rather than the raw file,
 * because the file documents what it deliberately does *not* do — the audio
 * player carries a comment saying "No `autoPlay`", which is the exact string
 * the autoplay check searches for. Matching the prose fails a correct file and
 * could be "fixed" by deleting the explanation.
 */
const code = component
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

const image = SHOWCASE.find((tab) => tab.id === "image")!;
const video = SHOWCASE.find((tab) => tab.id === "video")!;
const audio = SHOWCASE.find((tab) => tab.id === "audio")!;

describe("the audio claim is one the product can keep", () => {
  it("never advertises music generation", () => {
    /**
     * `replicate/music` is MusicGen, CC-BY-NC-4.0, and `model-policy.ts`
     * records it as `BLOCKED_COMMERCIAL` with `permittedAudience: "nobody"`.
     * Atheos cannot generate music, so the marketing page must not say it can
     * — in either language.
     */
    for (const [name, copy] of [
      ["en", EN],
      ["es", ES],
    ] as const) {
      const panel = copy.showcase.find((entry) => /audio/i.test(entry.label))!;
      const text = [panel.headline, panel.body, ...panel.bullets]
        .join(" ")
        .toLowerCase();

      expect(text, `${name} headline claims music`).not.toMatch(
        /\bmusic\b|\bmúsica\b/,
      );
    }
  });

  it("describes what the approved model actually does", () => {
    const panel = EN.showcase.find((entry) => /audio/i.test(entry.label))!;
    const text = [panel.headline, ...panel.bullets].join(" ").toLowerCase();
    expect(text).toMatch(/sound effect|foley|ambience/);
  });

  it("labels the example honestly", () => {
    expect(audio.audio?.title.trim().length).toBeGreaterThan(4);
    expect(audio.mediaCaption.toLowerCase()).toContain("sound design");
    expect(audio.mediaCaption.toLowerCase()).not.toMatch(/\bmusic\b/);
  });
});

describe("the video claim is one the file can keep", () => {
  it("never says native audio", () => {
    const claim =
      `${video.mediaCaption} ${video.video?.label ?? ""}`.toLowerCase();
    expect(claim).toContain("sound design");
    expect(claim).not.toContain("native audio");
    expect(code.toLowerCase()).not.toContain("native audio");
  });

  it("ships a video that really has an audio track", () => {
    /**
     * A "with sound design" label on a silent file is the same lie as
     * "native audio" on a mixed one. The `mp4a` box is the AAC sample entry;
     * it is not present in a stripped file.
     */
    const file = media(video.video!.src);
    expect(existsSync(file), video.video!.src).toBe(true);
    expect(readFileSync(file).includes(Buffer.from("mp4a"))).toBe(true);
  });

  it("has a poster so the panel is never an empty box", () => {
    const poster = media(video.video!.poster);
    expect(existsSync(poster), video.video!.poster).toBe(true);
    expect(statSync(poster).size).toBeGreaterThan(4000);
  });
});

describe("every file a tab points at exists and has content", () => {
  it("ships the audio example, and it is not silent", () => {
    const file = media(audio.audio!.src);
    expect(existsSync(file), audio.audio!.src).toBe(true);
    // 128 KB of AAC is not an empty container. A silent-but-present track
    // would still be caught by the runtime check in the browser evidence.
    expect(statSync(file).size).toBeGreaterThan(20_000);
    expect(readFileSync(file).includes(Buffer.from("mp4a"))).toBe(true);
  });

  it("ships the still at a size the panel can use", () => {
    const file = resolve(PUBLIC, `marketing/${image.image}.webp`);
    expect(existsSync(file), image.image).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(50_000);
  });

  it("does not claim 4K, because the file is not 4K", () => {
    /**
     * 1344x768 native from `flux-dev`, and that is the ceiling of the approved
     * image models — FLUX returns 1344x768 for "16:9", and the
     * higher-resolution alternatives have no entry in `model-policy.ts`, so
     * they cannot be used at all. The caption states the real dimensions.
     *
     * It is also 7:4 rather than exactly 16:9 (1.75 against 1.778), which
     * `object-cover` trims by about 1.6% of the width. Worth knowing before
     * anyone calls it native 16:9.
     */
    expect(image.mediaCaption.toLowerCase()).not.toMatch(/\b4k\b/);
    expect(image.mediaCaption).toContain("1344x768");
  });
});

describe("only the active tab's media can play", () => {
  it("renders one media element per panel, chosen by what the tab has", () => {
    // The panel is keyed on the tab id, so switching unmounts the previous
    // subtree and the element goes with it. That is what makes the rule
    // structural rather than a listener somebody has to remember to add.
    expect(code).toMatch(/if \(panel\.video\) return <ShowcaseVideo/);
    expect(code).toMatch(/if \(panel\.audio\) return <ShowcaseAudio/);
  });

  it("never autoplays the audio tab", () => {
    /**
     * Sound that starts because a tab opened is the thing every visitor
     * resents, and on mobile it is the thing that gets a tab closed. The video
     * may autoplay because it is muted; the audio may not, at all.
     */
    const audioBlock = code.slice(code.indexOf("function ShowcaseAudio"));
    expect(audioBlock).not.toMatch(/autoPlay/);
  });

  it("autoplays the video only muted", () => {
    const videoBlock = code.slice(
      code.indexOf("function ShowcaseVideo"),
      code.indexOf("function ShowcaseAudio"),
    );
    expect(videoBlock).toMatch(/autoPlay/);
    expect(videoBlock).toMatch(/\bmuted\b/);
  });
});

describe("the controls are real controls", () => {
  it("gives the audio player play, seek, volume and mute", () => {
    for (const label of ['aria-label="Seek"', 'aria-label="Volume"']) {
      expect(component, label).toContain(label);
    }
    expect(component).toMatch(/Pause audio|Play audio/);
    expect(component).toMatch(/Unmute — currently muted/);
  });

  it("seeks with a range input rather than a clickable div", () => {
    // A div with a click handler cannot be dragged with a keyboard, and
    // seeking is exactly the interaction a keyboard user needs.
    expect(component).toMatch(/<input\s+type="range"/);
  });

  it("puts playback state in the accessible name, not only the icon", () => {
    expect(component).toMatch(/Play with sound — currently muted/);
    expect(component).toMatch(/Mute — sound is on/);
  });

  it("drives the waveform from playback rather than animating regardless", () => {
    // A bar pattern that moves while nothing plays is decoration pretending to
    // be information.
    expect(component).toMatch(/index \/ BARS\.length <= progress/);
  });

  it("follows the element rather than leading it", () => {
    // Autoplay can be refused and a user can use the native context menu.
    // State that leads the element ends up describing something else.
    for (const event of ["play", "pause", "volumechange", "timeupdate"]) {
      expect(component, event).toContain(`"${event}"`);
    }
  });
});
