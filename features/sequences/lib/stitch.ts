import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

/**
 * Concatenate a sequence's clips into one MP4, in the browser.
 *
 * ## Why the browser and not a function
 *
 * `SEQUENCES_SPEC.md` planned for `ffmpeg-static` (~70 MB) inside a Vercel
 * function with `maxDuration: 300`. Two facts killed that: the Hobby plan caps
 * a function at **60 seconds**, and 70 MB of binary in a lambda is most of the
 * unzipped size budget. Sixteen clips is ~32 MB down from R2 and ~32 MB back
 * up, which is not a 60-second job.
 *
 * In the browser it is none of our compute, no upload at all, and the user's
 * machine is idle anyway while they watch clips render.
 *
 * ## `-c copy` is what makes this fast
 *
 * Every clip comes from the same model at the same resolution, frame rate and
 * codec, so the concat is a **stream copy** — no decode, no re-encode. Sixteen
 * clips take seconds rather than the several minutes a re-encode would. This
 * is the single fact the whole feature rests on, and it is also why mixing
 * Motion 1 and Motion Pro clips in one sequence is refused upstream: different
 * resolutions cannot be stream-copied together.
 *
 * ## The core is served from our own R2
 *
 * Not from unpkg. The default is a CDN we do not control, on the page where a
 * user's work is assembled, and our CSP does not allow it. 31 MB is also too
 * much to commit to the repository — R2 already serves media, already has an
 * allowed CSP origin, and caches it immutably.
 */

const CORE_BASE = `${process.env.NEXT_PUBLIC_R2_PUBLIC_URL}/vendor/ffmpeg/0.12`;

export interface StitchProgress {
  /** 0–1 while the concat runs. */
  ratio: number;
  stage: "loading" | "fetching" | "stitching" | "done";
}

/**
 * Loaded once per page, not once per stitch.
 *
 * The core is 31 MB. Re-instantiating it for a second attempt would re-download
 * it, and the browser cache is not something to rely on for something this
 * large.
 */
let instance: FFmpeg | null = null;

async function loadFfmpeg(onProgress?: (p: StitchProgress) => void) {
  if (instance) return instance;

  const ffmpeg = new FFmpeg();
  onProgress?.({ ratio: 0, stage: "loading" });

  await ffmpeg.load({
    coreURL: `${CORE_BASE}/ffmpeg-core.js`,
    wasmURL: `${CORE_BASE}/ffmpeg-core.wasm`,
  });

  instance = ffmpeg;
  return ffmpeg;
}

/**
 * Returns a Blob of the concatenated MP4.
 *
 * `urls` must already be in cut order — this does not sort them, because the
 * order is the sequence's `index` and re-deriving it here would be a second
 * place for the cut to be wrong.
 */
export async function stitchClips(
  urls: string[],
  onProgress?: (p: StitchProgress) => void,
): Promise<Blob> {
  if (urls.length === 0) throw new Error("Nothing to stitch.");

  const ffmpeg = await loadFfmpeg(onProgress);

  onProgress?.({ ratio: 0, stage: "fetching" });

  const names: string[] = [];
  for (const [index, url] of urls.entries()) {
    const name = `clip${String(index).padStart(3, "0")}.mp4`;
    await ffmpeg.writeFile(name, await fetchFile(url));
    names.push(name);
    onProgress?.({ ratio: (index + 1) / urls.length, stage: "fetching" });
  }

  // The concat demuxer reads a manifest rather than taking the files as
  // arguments. Single quotes around each name because ffmpeg's parser treats
  // the line as a shell-ish token, and a filename is safer quoted even when we
  // generated it ourselves.
  await ffmpeg.writeFile(
    "list.txt",
    names.map((name) => `file '${name}'`).join("\n"),
  );

  onProgress?.({ ratio: 0, stage: "stitching" });
  ffmpeg.on("progress", ({ progress }) =>
    onProgress?.({
      ratio: Math.min(1, Math.max(0, progress)),
      stage: "stitching",
    }),
  );

  await ffmpeg.exec([
    "-f",
    "concat",
    // The manifest names files in ffmpeg's own virtual filesystem, not the
    // host's. Without `-safe 0` the demuxer rejects them as unsafe paths.
    "-safe",
    "0",
    "-i",
    "list.txt",
    "-c",
    "copy",
    // Puts the index at the front of the file so the result starts playing
    // before it has fully downloaded. Free — it is a remux, not a re-encode.
    "-movflags",
    "+faststart",
    "out.mp4",
  ]);

  const data = await ffmpeg.readFile("out.mp4");

  // Free the virtual filesystem. Sixteen clips is ~32 MB held in wasm memory
  // that a second stitch on the same page would add to rather than reuse.
  for (const name of [...names, "list.txt", "out.mp4"]) {
    await ffmpeg.deleteFile(name).catch(() => undefined);
  }

  onProgress?.({ ratio: 1, stage: "done" });
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: "video/mp4" });
}

/**
 * Mux a generated audio track over a stitched video.
 *
 * Separate from `stitchClips` because the audio is optional and produced by a
 * different model — asking somebody to regenerate sixteen clips because they
 * changed their mind about the music would be indefensible.
 *
 * The video stream is still copied; only the audio is encoded, and `-shortest`
 * cuts whichever runs longer so the result never ends on silence or a frozen
 * frame.
 */
export async function muxAudio(
  videoBlob: Blob,
  audioUrl: string,
  onProgress?: (p: StitchProgress) => void,
): Promise<Blob> {
  const ffmpeg = await loadFfmpeg(onProgress);

  onProgress?.({ ratio: 0, stage: "fetching" });
  await ffmpeg.writeFile(
    "video.mp4",
    new Uint8Array(await videoBlob.arrayBuffer()),
  );
  await ffmpeg.writeFile("audio.dat", await fetchFile(audioUrl));

  onProgress?.({ ratio: 0, stage: "stitching" });
  await ffmpeg.exec([
    "-i",
    "video.mp4",
    "-i",
    "audio.dat",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    "scored.mp4",
  ]);

  const data = await ffmpeg.readFile("scored.mp4");

  for (const name of ["video.mp4", "audio.dat", "scored.mp4"]) {
    await ffmpeg.deleteFile(name).catch(() => undefined);
  }

  onProgress?.({ ratio: 1, stage: "done" });
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: "video/mp4" });
}
