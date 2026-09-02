/**
 * Turn the selected gallery masters into what the browser actually downloads.
 *
 *   node scripts/build-gallery-media.mjs
 *
 * ## What it produces
 *
 * For every card: one 1280w WebP poster. For video cards: an MP4 cut to web
 * weight as well. Filenames carry a content hash, so `next.config.ts` can
 * serve them `immutable` for a year and a re-encode gets a new URL instead of
 * a stale cache.
 *
 * One poster, not two. An earlier version built 640w and 1280w and handed the
 * 640 to `next/image` — which then had no way to produce anything sharper for
 * a retina card, and re-encoded the already-optimised file at its default
 * quality of 75 on the way. The 1280 is the source `next/image` resizes from,
 * so the 640 was 26 files nothing ever requested.
 *
 * ## Why posters for images too
 *
 * A 2048x2048 PNG is 7 MB. Thirty of those is a quarter of a gigabyte on a
 * page that renders them at 400 CSS px. The PNG stays in `media-source/` as
 * the master; the site gets WebP at the two sizes it can actually use.
 *
 * ## Why the video is re-encoded rather than served as delivered
 *
 * The provider returns 1080p at 10-20 Mbps. These are secondary cards that
 * only load after a click, but "after a click" still has to arrive quickly on
 * a phone, so each is capped at 720p and CRF 32. The master is untouched and
 * `docs/GALLERY-PROVENANCE.md` records both hashes, exactly as the hero does.
 *
 * ## Idempotent
 *
 * A derivative whose master has not changed is not re-encoded — the hash of
 * the master is part of the output name, so an unchanged master produces a
 * name that already exists.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public", "marketing", "gallery");
const SELECTION = path.join(ROOT, "media-source", "gallery-selection.json");

const sha = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

const ffmpeg = (args) =>
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "pipe" });

function probe(file) {
  const out = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      file,
    ],
    { encoding: "utf8" },
  ).trim();
  const [width, height] = out.split(",").map(Number);
  return { width, height };
}

/** A poster at one width, named by the master's hash. */
function poster(master, id, width, atSeconds) {
  const stamp = sha(master).slice(0, 10);
  const name = `${id}-${width}.${stamp}.webp`;
  const file = path.join(OUT, name);
  if (!existsSync(file)) {
    const seek = atSeconds === undefined ? [] : ["-ss", String(atSeconds)];
    ffmpeg([
      ...seek,
      "-i",
      master,
      "-frames:v",
      "1",
      "-vf",
      `scale=${width}:-2:flags=lanczos`,
      "-quality",
      "80",
      file,
    ]);
  }
  return `/marketing/gallery/${name}`;
}

/** The playable file, capped at 720p on the long edge. */
function clip(master, id) {
  const stamp = sha(master).slice(0, 10);
  const name = `${id}.${stamp}.mp4`;
  const file = path.join(OUT, name);
  if (!existsSync(file)) {
    const { width, height } = probe(master);
    // Cap the long edge at 1280 and keep the short edge even for yuv420p.
    const scale =
      width >= height
        ? "scale='min(1280,iw)':-2:flags=lanczos"
        : "scale=-2:'min(1280,ih)':flags=lanczos";
    ffmpeg([
      "-i",
      master,
      "-vf",
      scale,
      "-c:v",
      "libx264",
      "-preset",
      "slower",
      "-crf",
      "32",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-an",
      file,
    ]);
  }
  return `/marketing/gallery/${name}`;
}

function main() {
  if (!existsSync(SELECTION)) {
    throw new Error(
      `No selection at ${path.relative(ROOT, SELECTION)}. Write it first.`,
    );
  }
  mkdirSync(OUT, { recursive: true });

  const selection = JSON.parse(readFileSync(SELECTION, "utf8"));
  const entries = [];

  for (const item of selection) {
    const master = path.join(ROOT, item.master);
    if (!existsSync(master)) throw new Error(`Missing master: ${item.master}`);

    const { width, height } = probe(master);
    // A frame that is not the first one: a video's first frame is often the
    // darkest, and a poster that reads as an empty black card is the exact
    // failure this gallery is replacing.
    const at = item.kind === "video" ? (item.posterAt ?? 1.5) : undefined;

    entries.push({
      id: item.id,
      kind: item.kind,
      category: item.category,
      prompt: item.prompt,
      modality: item.kind === "video" ? "VIDEO" : "IMAGE",
      width,
      height,
      poster: poster(master, item.id, 1280, at),
      ...(item.kind === "video" ? { src: clip(master, item.id) } : {}),
      masterSha256: sha(master),
    });
    process.stdout.write(`  ${item.id.padEnd(24)} ${width}x${height}\n`);
  }

  writeFileSync(
    path.join(ROOT, "media-source", "gallery-built.json"),
    JSON.stringify(entries, null, 2),
  );

  /**
   * The module the site imports.
   *
   * Generated rather than hand-kept because every field in it is a measured
   * fact — the hashed filename, the master's real pixel dimensions, the hash
   * itself. A hand-written copy drifts from the files on disk the first time
   * someone re-encodes one, and the gallery's whole claim is that the numbers
   * under the cards are true.
   */
  const generated = `// Generated by scripts/build-gallery-media.mjs. Do not edit by hand.
//
// Every entry is derived from a master in \`media-source/\`: the dimensions are
// probed, the filenames carry the master's content hash, and the prompt is the
// one that produced it. Re-run the script after changing
// \`media-source/gallery-selection.json\`.

export interface GalleryItem {
  /** Stable slug. Also the filename stem, so it must stay unique. */
  id: string;
  kind: "image" | "video";
  /** Shown on the card, and the label the filters group by. */
  category: string;
  /** The prompt that made it. Shown under the card. */
  prompt: string;
  /** What "Try this" opens the studio in. */
  modality: "IMAGE" | "VIDEO";
  /** The master's real pixels, used for the aspect box so nothing shifts. */
  width: number;
  height: number;
  /** 1280w WebP. \`next/image\` resizes down from this for smaller cards. */
  poster: string;
  /** Videos only. Loaded on interaction, never before. */
  src?: string;
  /** The master this was derived from, recorded in docs/GALLERY-PROVENANCE.md. */
  masterSha256: string;
}

export const GALLERY: readonly GalleryItem[] = ${JSON.stringify(entries, null, 2)} as const;
`;

  writeFileSync(
    path.join(ROOT, "features", "marketing", "gallery.generated.ts"),
    generated,
  );

  const bytes = readdirSync(OUT).reduce(
    (sum, f) => sum + readFileSync(path.join(OUT, f)).byteLength,
    0,
  );
  // `process.stdout` rather than `console.log`, to match the per-card lines
  // above and to stay inside the repo's no-console rule.
  process.stdout.write(
    `\n${entries.length} cards, ${readdirSync(OUT).length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB total\n`,
  );
}

main();
