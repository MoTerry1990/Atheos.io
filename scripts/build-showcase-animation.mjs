/**
 * Animate the approved still into the showcase video — locally, no provider.
 *
 *   node scripts/build-showcase-animation.mjs
 *
 * ## Why this is compositing and not a generation
 *
 * Two generated videos were rejected: both put people in an environment the
 * prompt described as empty, and neither matched the approved still. A third
 * attempt would have been a third roll of the same dice. Animating the still
 * that was already approved removes the question entirely — the frame cannot
 * contain a person, or text, or a different scene, because every pixel comes
 * from an image that was inspected and passed.
 *
 * It is honest about what it is: `AI-generated visual with cinematic animation
 * and sound design`. Not AI-generated video.
 *
 * ## The crop, and why 1344x756
 *
 * The still is 1344x768, which is 7:4 (1.75) and not 16:9. Six rows off the
 * top and six off the bottom give 1344x756 — exactly 16:9, verified as
 * `1344/756 === 16/9` rather than approximately. The composition survives it:
 * the core is centred and the arch and floor are untouched.
 *
 * ## Nothing is ever upscaled
 *
 * The push-in is a shrinking crop of the 1344-wide source, scaled to 1280.
 * At the maximum zoom of 1.05 the crop is 1344/1.05 = 1280 px wide, which is
 * exactly 1:1 — so the tightest frame in the move is still not an upscale, and
 * every frame before it is a downscale. That is why the zoom stops at 1.05 and
 * not at a rounder number.
 *
 * ## Why it loops without a cut
 *
 * The zoom curve is a raised cosine: velocity is zero at both ends. The clip is
 * then played forward and reversed, so the join is frame-identical *and* the
 * motion does not reverse direction abruptly — a linear ramp ping-ponged looks
 * like a bounce, which is the tell of a cheap loop.
 *
 * ## The particle layer
 *
 * Generated once as a sparse dot field, then scrolled at two different speeds
 * and screen-blended at low opacity. Two speeds because one is a moving
 * texture and two is depth. Kept at 6-9% so it reads as atmosphere rather than
 * as snow.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "media-source", "showcase-v2");
const STILL = path.join(OUT, "core-image.png");

/** Half the clip. Ping-pong doubles it to ~8s. */
const HALF = 4.0;
const FPS = 30;
/** 1344 / 1.05 = 1280 exactly. Any more would upscale. */
const MAX_ZOOM = 1.05;

const ffmpeg = (args) =>
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "pipe" });

function particles(file, seed, density) {
  if (existsSync(file)) return file;
  // A tall field so it can scroll for the whole clip without repeating.
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=black:s=1280x2160`,
    "-vf",
    `geq=lum='if(gt(random(${seed}),${density}),255,0)':cb=128:cr=128,boxblur=1:1`,
    "-frames:v",
    "1",
    file,
  ]);
  return file;
}

function main() {
  if (!existsSync(STILL)) throw new Error(`Missing ${STILL}`);
  mkdirSync(OUT, { recursive: true });

  const near = particles(path.join(OUT, "particles-near.png"), 11, 0.99955);
  const far = particles(path.join(OUT, "particles-far.png"), 29, 0.99975);

  /**
   * Raised cosine, 1 → MAX_ZOOM over HALF seconds.
   *
   * `zf` appears three times, so it is written once and interpolated. Crop
   * dimensions are forced even — an odd crop breaks yuv420p.
   */
  const zf = `(1+${MAX_ZOOM - 1}*(0.5-0.5*cos(PI*min(t,${HALF})/${HALF})))`;
  const cw = `2*floor(1344/${zf}/2)`;
  const ch = `2*floor(756/${zf}/2)`;

  const chain = [
    // Exact 16:9 from the 7:4 still, then the push-in, then down to 720p.
    `crop=1344:756:0:6`,
    `crop=w='${cw}':h='${ch}':x='(in_w-out_w)/2':y='(in_h-out_h)/2'`,
    `scale=1280:720:flags=lanczos`,
    // The core is the brightest thing in frame, so a small global lift reads
    // as the core breathing rather than as the whole picture flickering.
    `eq=brightness='0.018*sin(2*PI*t/${HALF})':saturation='1+0.05*sin(2*PI*t/${HALF})':eval=frame`,
  ].join(",");

  const out = path.join(OUT, "core-animated.mp4");
  ffmpeg([
    "-loop",
    "1",
    "-t",
    String(HALF),
    "-i",
    STILL,
    "-loop",
    "1",
    "-t",
    String(HALF),
    "-i",
    near,
    "-loop",
    "1",
    "-t",
    String(HALF),
    "-i",
    far,
    "-filter_complex",
    [
      `[0:v]fps=${FPS},${chain}[base]`,
      // Two scrolling fields at different speeds: one texture is movement,
      // two is depth.
      `[1:v]fps=${FPS},crop=1280:720:0:'(1-t/${HALF})*1440':scale=1280:720[p1]`,
      `[2:v]fps=${FPS},crop=1280:720:0:'(1-t/${HALF})*1440*0.45':scale=1280:720[p2]`,
      `[base][p1]blend=all_mode=screen:all_opacity=0.09[b1]`,
      `[b1][p2]blend=all_mode=screen:all_opacity=0.06[fwd]`,
      // Ping-pong: frame-identical join, and zero velocity at the turn.
      `[fwd]split[f][b];[b]reverse[r];[f][r]concat=n=2:v=1:a=0[v]`,
    ].join(";"),
    "-map",
    "[v]",
    "-c:v",
    "libx264",
    "-preset",
    "slower",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    out,
  ]);

  process.stdout.write(
    `  core-animated.mp4  ${(statSync(out).size / 1024).toFixed(0)} KB\n`,
  );
}

main();
