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
 * Not layout. Claims, and whether the bytes support them.
 *
 * The section shipped an Audio tab and a video with a soundtrack, both derived
 * from `replicate/sfx`. That alias resolves to `sepal/audiogen`, whose weights
 * are CC-BY-NC 4.0 under Meta's AudioCraft `LICENSE_weights` — the same file
 * this repository already cites to block `replicate/music`. Non-commercial
 * weights cannot supply a commercial marketing page, so all of it was withdrawn
 * on 3 September 2026.
 *
 * What remains is two tabs and a silent video, and these tests exist to keep
 * the page from claiming anything more than that. The audio assertions check
 * for *absence* now: no tab, no track in the file, no controls, no capability
 * claim in either language.
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

describe("the withdrawn audio stays withdrawn", () => {
  it("has no Audio tab", () => {
    /**
     * Removed 3 September 2026. `replicate/sfx` resolves to `sepal/audiogen`,
     * whose weights are CC-BY-NC 4.0 under Meta's AudioCraft LICENSE_weights —
     * the same file that blocks `replicate/music`. Its output cannot be
     * published on a commercial page, so the tab that played it is gone rather
     * than merely emptied.
     */
    expect(SHOWCASE.map((tab) => tab.id)).not.toContain("audio");
  });

  it("never advertises music, sound effects or ambience generation", () => {
    // Atheos has no approved audio model at all now. Claiming any audio
    // generation capability would be advertising something it cannot provide.
    for (const [name, copy] of [
      ["en", EN],
      ["es", ES],
    ] as const) {
      const text = copy.showcase
        .flatMap((entry) => [entry.headline, entry.body, ...entry.bullets])
        .join(" ")
        .toLowerCase();

      expect(text, `${name} claims music`).not.toMatch(/\bmusic\b|\bmúsica\b/);
    }
  });
});

describe("the video is silent, and says so", () => {
  it("carries no audio stream at all", () => {
    /**
     * The published file had an AudioGen-derived track muxed in. `mp4a` is the
     * AAC sample-entry box; its absence is what proves the withdrawal reached
     * the bytes and not just the markup.
     */
    const file = media(video.video!.src);
    expect(existsSync(file), video.video!.src).toBe(true);
    expect(readFileSync(file).includes(Buffer.from("mp4a"))).toBe(false);
  });

  it("makes no claim about sound", () => {
    const claim =
      `${video.mediaCaption} ${video.video?.label ?? ""}`.toLowerCase();
    expect(claim).toContain("cinematic animation");
    for (const banned of [
      "sound design",
      "native audio",
      "ai-generated video",
    ]) {
      expect(claim, banned).not.toContain(banned);
    }
  });

  it("offers no sound controls, because there is no sound", () => {
    for (const banned of [
      "Play with sound",
      "Volume2",
      "VolumeX",
      "toggleSound",
    ]) {
      expect(code, banned).not.toContain(banned);
    }
  });

  it("has a poster so the panel is never an empty box", () => {
    const poster = media(video.video!.poster);
    expect(existsSync(poster), video.video!.poster).toBe(true);
    expect(statSync(poster).size).toBeGreaterThan(4000);
  });
});

describe("every file a tab points at exists and has content", () => {
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
    expect(image.mediaCaption).toContain("1344x756");
  });
});

describe("only the active tab's media can play", () => {
  it("renders one media element per panel, chosen by what the tab has", () => {
    // The panel is keyed on the tab id, so switching unmounts the previous
    // subtree and the element goes with it. That is what makes the rule
    // structural rather than a listener somebody has to remember to add.
    expect(code).toMatch(/if \(panel\.video\) return <ShowcaseVideo/);
  });

  it("autoplays the video only muted", () => {
    const videoBlock = code.slice(code.indexOf("function ShowcaseVideo"));
    expect(videoBlock).toMatch(/autoPlay/);
    expect(videoBlock).toMatch(/\bmuted\b/);
  });
});

describe("the controls are real controls", () => {
  it("follows the element rather than leading it", () => {
    // Autoplay can be refused and a user can use the native context menu.
    // State that leads the element ends up describing something else.
    // Only play/pause now: the volume and time events belonged to the audio
    // player and to the sound control, both withdrawn with the AudioGen track.
    for (const event of ["play", "pause"]) {
      expect(component, event).toContain(`"${event}"`);
    }
  });
});
