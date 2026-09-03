/**
 * Build the home page showcase media — locally, from assets already approved.
 *
 *   node scripts/build-showcase-media.mjs
 *
 * ## What this makes, and why it is not a generation
 *
 * The Video tab needs a technology clip that actually has sound. No model in
 * the catalogue can supply one: the only video masters with an audio track
 * fail the motion requirement, and the two models with native audio are
 * `OWNER_EVALUATION_ONLY_PENDING_TERMS`, so their output cannot be published
 * commercially at any price.
 *
 * What *is* approved is a video with no audio and a separately generated Foley
 * ambience — `replicate/sfx`, MIT (MMAudio), `ALLOWED_PUBLIC`,
 * `commercialOutput: "permitted"`. Putting them together is sound design, done
 * here, on this machine, with no provider call. That is why the label on the
 * page reads "AI-generated video with sound design" and never "native audio".
 *
 * ## The master is never touched
 *
 * `media-source/showcase/neural-core.mp4` is what the model returned and stays
 * that way. The published file is a crop and a re-encode of it, and the two are
 * linked by the hash in the output name — the same arrangement as the hero and
 * the gallery.
 *
 * An earlier version of this script sourced an existing published clip and used
 * `-c:v copy`, which made "original preserved unchanged" a fact rather than a
 * claim. The crop ended that: you cannot crop a copied stream. The guarantee
 * moved to the master instead, which is the one that matters.
 *
 * ## The audio is 8 seconds and the video ends up at 10
 *
 * The source clip is 5 seconds and ping-pong doubles it, so the 8-second
 * ambience is looped by `-stream_loop` and then trimmed to the doubled length.
 * A hard cut at either end is audible, so there is a fade in at the head and a
 * fade out at the tail, and the whole track is normalised to EBU R128 with a
 * true-peak ceiling so nothing clips. Ambience sits well below dialogue level,
 * which is why the target is -20 LUFS rather than the -16 a music bed would use.
 *
 * ## Naming
 *
 * Output names carry a hash of *both* inputs, so changing either source
 * produces a new URL and the `immutable` cache header stays honest.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public", "marketing", "showcase");

/**
 * The approved video: Motion 1, generated for this panel, no audio track.
 *
 * `display-macro` was the first choice and failed visual review — the marks on
 * its television are illegible generated glyphs, bright and centred, which is
 * one of the stated rejection criteria. No crop could remove them: the camera
 * pulls back, so the screen travels from upper-left to centre, and a crop tight
 * enough to exclude them at the head is 768px wide and would have to be
 * upscaled to fill the panel.
 *
 * This replacement cost $0.10 on Motion 1 — `ALLOWED_PUBLIC`, Apache-2.0,
 * commercial output permitted. It is the cheapest approved video model; the
 * two with native audio are owner-evaluation-only and cannot be published.
 */
const VIDEO = path.join(ROOT, "media-source/showcase/neural-core.mp4");

/**
 * A crop, because the replacement has faint glyphs too.
 *
 * They are far weaker than the ones that failed `display-macro` — dim
 * component silkscreen at the extreme left edge rather than bright lettering on
 * a lit screen — but they are still generated marks, so the clearest one is
 * cropped out. 1120x630 from 1280x720: still exactly 16:9, still native pixels,
 * nothing upscaled. The composition is centred on the die, so the crop tightens
 * it rather than damaging it.
 *
 * What remains is a silkscreen-scale marking on the die itself, legible only
 * under magnification. `docs/SHOWCASE-PROVENANCE.md` says so rather than
 * claiming the frame is spotless.
 */
const CROP = "crop=1120:630:100:45";
/** The approved ambience: `replicate/sfx`, MIT, commercial use permitted. */
const AUDIO = path.join(ROOT, "media-source/showcase/foley-ambience.wav");

/** The Image tab still: `img-technology-01`, native 2752x1536. */
const STILL = path.join(ROOT, "media-source/generated/img-technology-01.png");

const ffmpeg = (args) =>
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "pipe" });

const probe = (file, entries, stream) =>
  execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      ...(stream ? ["-select_streams", stream] : []),
      "-show_entries",
      entries,
      "-of",
      "csv=p=0",
      file,
    ],
    { encoding: "utf8" },
  ).trim();

const sha = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

function main() {
  for (const file of [VIDEO, AUDIO, STILL]) {
    if (!existsSync(file)) throw new Error(`Missing input: ${file}`);
  }
  mkdirSync(OUT, { recursive: true });

  const videoSha = sha(VIDEO);
  const audioSha = sha(AUDIO);
  const stamp = createHash("sha256")
    .update(videoSha + audioSha)
    .digest("hex")
    .slice(0, 10);

  const sourceDuration = Number(probe(VIDEO, "format=duration"));
  /** Ping-pong doubles it. See the video chain below. */
  const duration = sourceDuration * 2;
  const fadeOut = Math.max(0, duration - 0.6);

  /**
   * Ping-pong: forward, then the same frames reversed.
   *
   * The clip is a slow dolly, so its last frame sits closer than its first and
   * a straight loop cuts visibly on repeat. Playing it back out again makes the
   * seam disappear by construction — the join is frame-identical at both ends —
   * and on a push-in it reads as a natural breathe rather than as a trick.
   *
   * `reverse` buffers every frame in memory, which is fine for 152 of them and
   * would not be for a long clip. The crop runs before the split so it is
   * applied once rather than to each branch.
   */
  const videoChain = `${CROP},split[f][b];[b]reverse[r];[f][r]concat=n=2:v=1:a=0`;

  /**
   * One filter chain, in the order the ear needs it.
   *
   * Loop and trim first so `loudnorm` measures the material that will actually
   * play; fade last so the fades are not themselves normalised away. The trim
   * is to the *doubled* length, because the ambience has to cover the whole
   * ping-pong rather than stopping halfway through it.
   *
   * The resample comes *after* `loudnorm`, and that ordering is the whole
   * point of this comment. `loudnorm` works internally at 192 kHz and emits at
   * that rate, so resampling before it produced a 96 kHz AAC track — legal,
   * and not what "broadly compatible" means. 44.1 kHz stereo is what every
   * decoder in the world handles without thinking about it.
   */
  const audioChain = [
    `atrim=0:${duration.toFixed(3)}`,
    "loudnorm=I=-20:TP=-1.5:LRA=11",
    "aresample=44100",
    "aformat=channel_layouts=stereo",
    "afade=t=in:st=0:d=0.5",
    `afade=t=out:st=${fadeOut.toFixed(3)}:d=0.6`,
  ].join(",");

  const videoName = `neural-core.${stamp}.mp4`;
  ffmpeg([
    "-i",
    VIDEO,
    "-stream_loop",
    "-1",
    "-i",
    AUDIO,
    /**
     * Both streams in one `filter_complex`, because `-vf` cannot be used
     * alongside it once the outputs are mapped by label.
     */
    "-filter_complex",
    `[0:v]${videoChain}[v];[1:a]${audioChain}[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    /**
     * Re-encoded rather than copied, because the crop changes pixels and a
     * stream copy cannot. CRF 26 rather than the gallery's 32: this panel is
     * one of three things a visitor looks at, not a thumbnail in a grid of
     * thirty. The master in `media-source/` is untouched either way.
     */
    "-c:v",
    "libx264",
    "-preset",
    "slower",
    "-crf",
    "26",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    path.join(OUT, videoName),
  ]);

  /** A frame that already shows movement, so the poster is not a dead start. */
  const posterName = `neural-core-1120.${stamp}.webp`;
  ffmpeg([
    "-ss",
    "0.8",
    "-i",
    VIDEO,
    "-frames:v",
    "1",
    // Same crop as the video, or the poster and the first frame would be
    // different pictures and the hand-off would jump.
    "-vf",
    `${CROP},scale=1120:-2:flags=lanczos`,
    "-quality",
    "82",
    path.join(OUT, posterName),
  ]);

  /**
   * The Image tab's still, at 2048 rather than the gallery's 1280.
   *
   * Same master as the gallery's `circuit-macro` — `img-technology-01`, native
   * 2752x1536, generated 2 September. The gallery serves 1280 because a card
   * paints at 400px; this panel paints at up to 1200 CSS px and wants a retina
   * source. 2048 is a downscale of a 2752 native, so nothing is invented: this
   * is not, and is never described as, a 4K asset.
   */
  const stillSha = sha(STILL);
  const stillName = `ai-technology-2048.${stillSha.slice(0, 10)}.webp`;
  ffmpeg([
    "-i",
    STILL,
    "-vf",
    "scale=2048:-2:flags=lanczos",
    "-quality",
    "86",
    path.join(OUT, stillName),
  ]);

  /** The same ambience on its own, for the Audio tab. */
  const audioName = `ambience.${stamp}.m4a`;
  ffmpeg([
    "-i",
    AUDIO,
    "-af",
    [
      "loudnorm=I=-20:TP=-1.5:LRA=11",
      "aresample=44100",
      "aformat=channel_layouts=stereo",
      "afade=t=in:st=0:d=0.3",
      "afade=t=out:st=7.4:d=0.6",
    ].join(","),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    path.join(OUT, audioName),
  ]);

  const report = [
    ["video", videoName],
    ["poster", posterName],
    ["still", stillName],
    ["audio", audioName],
  ];
  for (const [kind, name] of report) {
    const file = path.join(OUT, name);
    process.stdout.write(
      `  ${kind.padEnd(7)} ${name.padEnd(42)} ${(statSync(file).size / 1024).toFixed(0).padStart(6)} KB\n`,
    );
  }

  process.stdout.write(
    `\n  video source sha256 ${videoSha.slice(0, 16)}…\n` +
      `  audio source sha256 ${audioSha.slice(0, 16)}…\n` +
      `  derived stamp       ${stamp}\n`,
  );
}

main();
