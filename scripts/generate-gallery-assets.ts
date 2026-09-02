/**
 * Generate the "Made with Atheos" gallery with the product's own models.
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/generate-gallery-assets.ts --plan
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/generate-gallery-assets.ts --run
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/generate-gallery-assets.ts --run img-fashion-01
 *
 * ## Why this exists alongside `generate-marketing-assets.ts`
 *
 * That script makes the *chrome* — hero, auth, feature tiles — at eight
 * fixed slots. This one makes the *gallery*, which is a different problem: it
 * needs breadth rather than a house look, every piece has to be distinguishable
 * from every other, and the count is a published claim rather than a layout
 * detail.
 *
 * ## Why generated and not sourced
 *
 * The section is called "Made with Atheos". There is a large stock-footage
 * library on this machine and none of it can appear here: putting Pexels
 * clips under that heading is a false authorship claim, and `/content-details`
 * tells visitors that nothing on the site is stock. The audit that led to this
 * script is in `docs/GALLERY-PROVENANCE.md`.
 *
 * ## Cost, and the cap
 *
 * Real money on the live Replicate account, at the rates in
 * `services/billing/model-costs.ts`: a 2K image is $0.150 and a second of Video
 * Pro is $0.054. Every job declares its own estimate, the run refuses to start
 * if the total exceeds `--cap` (default $25), and it stops mid-run the moment
 * actual spend would cross it. `--plan` prices the whole run without sending
 * anything.
 *
 * ## Determinism
 *
 * There is none, and it is not an oversight. `nano-banana-pro` does not accept
 * a seed — `capabilities.supportsSeed` is `false` in
 * `services/ai/providers/replicate.ts` — so a re-run produces different pixels.
 * That is why outputs land in `media-source/generated/` and are promoted into
 * `public/marketing/` by hand: a re-run cannot silently redecorate the site.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Pinned to match `services/ai/providers/replicate.ts` exactly. */
const PRO_IMAGE =
  "93f55bfdbdfd4a62e16bf861729bcfa9e8fd9b0325fb218cbc4dd138ecc87cc7";
const VIDEO_PRO =
  "6e47dd83529ee0599c68f274f225635080e4fd218360a85e2a3a78396d388b73";

/** From `services/billing/model-costs.ts`. Used for the cap, not for billing. */
const IMAGE_USD = 0.15;
const VIDEO_USD_PER_SECOND = 0.054;

const OUT = path.join(process.cwd(), "media-source", "generated");
const TOKEN = process.env.REPLICATE_API_TOKEN;

type Aspect = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3";

interface ImageJob {
  id: string;
  kind: "image";
  category: string;
  aspect: Aspect;
  prompt: string;
}

interface VideoJob {
  id: string;
  kind: "video";
  category: string;
  aspect: "16:9" | "9:16";
  seconds: number;
  prompt: string;
}

type Job = ImageJob | VideoJob;

/**
 * The brief.
 *
 * Sixteen images and three videos, one per category, chosen to fill what the
 * existing library does not have. The library is five near-identical dragons,
 * five near-identical red convertibles, three paper boats and a bowl — so
 * every prompt here is deliberately somewhere else: different subject,
 * different palette, different light. Two of the categories the brief asks for
 * (automotive, fantasy) are already covered by existing work and are absent
 * here on purpose.
 *
 * Prompts are written to be shown. Each one appears under its card, so it has
 * to read as something a person would actually type, not as a keyword salad
 * with a quality-token tail.
 */
const JOBS: Job[] = [
  {
    id: "img-portrait-01",
    kind: "image",
    category: "Portrait",
    aspect: "4:3",
    prompt:
      "An editorial portrait of an older woman with silver hair, soft window light from the left, shallow depth of field, natural skin texture",
  },
  {
    id: "img-portrait-02",
    kind: "image",
    category: "Portrait",
    aspect: "3:4",
    prompt:
      "A close portrait of a young man in a knitted collar, overcast daylight, muted greens, quiet expression",
  },
  {
    id: "img-fashion-01",
    kind: "image",
    category: "Fashion",
    aspect: "3:4",
    prompt:
      "A model in a structured cream coat against a sunlit concrete wall, hard midday shadow, minimal styling",
  },
  {
    id: "img-fashion-02",
    kind: "image",
    category: "Fashion",
    aspect: "2:3",
    prompt:
      "Flowing scarlet silk caught mid-air in a studio, black background, single hard light, no model",
  },
  {
    id: "img-architecture-01",
    kind: "image",
    category: "Architecture",
    aspect: "3:2",
    prompt:
      "A brutalist concrete stairwell lit by a single skylight, geometric shadow, warm grey tones",
  },
  {
    id: "img-architecture-02",
    kind: "image",
    category: "Architecture",
    aspect: "16:9",
    prompt:
      "A glass atrium at golden hour seen from below, steel lattice ceiling, long diagonal light",
  },
  {
    id: "img-nature-01",
    kind: "image",
    category: "Nature",
    aspect: "16:9",
    prompt:
      "Mist moving through an old pine forest at first light, cool blue shadows, shafts of sun",
  },
  {
    id: "img-nature-02",
    kind: "image",
    category: "Nature",
    aspect: "3:2",
    prompt:
      "A single white poppy in close focus against a green field gone soft, morning dew",
  },
  {
    id: "img-technology-01",
    kind: "image",
    category: "Technology",
    aspect: "16:9",
    prompt:
      "A circuit board photographed as landscape, macro lens, teal solder mask and gold traces, raking light",
  },
  {
    id: "img-scifi-01",
    kind: "image",
    category: "Science fiction",
    aspect: "16:9",
    prompt:
      "A lone research station on an ice plain under a ringed planet, cold blue light, tiny human figure for scale",
  },
  {
    id: "img-scifi-02",
    kind: "image",
    category: "Science fiction",
    aspect: "2:3",
    prompt:
      "An orbital elevator seen from the base at dusk, warm ground haze fading into black sky",
  },
  {
    id: "img-product-01",
    kind: "image",
    category: "Product",
    aspect: "1:1",
    prompt:
      "A brushed titanium watch on a slab of pale stone, studio softbox, controlled reflections, no branding",
  },
  {
    id: "img-product-02",
    kind: "image",
    category: "Product",
    aspect: "1:1",
    prompt:
      "An amber glass bottle on a seamless sand backdrop, hard side light, long clean shadow, no label",
  },
  {
    id: "img-food-01",
    kind: "image",
    category: "Food",
    aspect: "4:3",
    prompt:
      "A halved fig on a linen cloth, late afternoon light, warm shadow, shot from just above",
  },
  {
    id: "img-abstract-01",
    kind: "image",
    category: "Abstract",
    aspect: "1:1",
    prompt:
      "Thick oil paint in ochre and deep teal pushed across a panel, raking light picking up the ridges",
  },
  {
    id: "img-abstract-02",
    kind: "image",
    category: "Abstract",
    aspect: "16:9",
    prompt:
      "Long-exposure light trails folding through smoke, warm amber against near-black, no visible source",
  },
  /**
   * The four added after the first run.
   *
   * The run reached 16 images and 2 videos before Replicate refused with
   * `402 Insufficient credit`. Two of the remaining four were then chosen to
   * cover categories the gallery has as video but not as stills, and vice
   * versa — the gap is breadth, not volume.
   */
  {
    id: "img-cinematic-01",
    kind: "image",
    category: "Cinematic",
    aspect: "16:9",
    prompt:
      "A film still of a figure alone at the end of a hotel corridor, anamorphic framing, one practical lamp, deep shadow",
  },
  {
    id: "img-interior-01",
    kind: "image",
    category: "Interior",
    aspect: "3:2",
    prompt:
      "A reading corner with a worn leather chair and a tall window, late winter light, dust in the air",
  },
  {
    id: "vid-product-01",
    kind: "video",
    category: "Product",
    aspect: "16:9",
    seconds: 5,
    prompt:
      "A slow turntable shot of a matte ceramic vase on a lit plinth, seamless backdrop, shadow sweeping as it turns",
  },
  {
    id: "vid-fashion-01",
    kind: "video",
    category: "Fashion",
    aspect: "9:16",
    seconds: 5,
    prompt:
      "Slow tracking shot alongside a model walking in a long camel coat down a sunlit colonnade, coat moving with each step",
  },
  {
    id: "vid-nature-01",
    kind: "video",
    category: "Nature",
    aspect: "16:9",
    seconds: 5,
    prompt:
      "A slow push through tall grass at golden hour, seed heads moving in the wind, sun flaring through",
  },
  {
    id: "vid-abstract-01",
    kind: "video",
    category: "Abstract",
    aspect: "16:9",
    seconds: 5,
    prompt:
      "Ink dropped into water, blooming and folding in slow motion, deep indigo against white",
  },
];

function estimate(job: Job): number {
  return job.kind === "image" ? IMAGE_USD : job.seconds * VIDEO_USD_PER_SECOND;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function replicate(
  version: string,
  input: Record<string, unknown>,
): Promise<string> {
  const start = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({ version, input }),
  });

  if (!start.ok) throw new Error(`${start.status} ${await start.text()}`);

  let prediction = (await start.json()) as {
    status: string;
    output?: unknown;
    error?: string;
    urls: { get: string };
  };

  while (prediction.status !== "succeeded" && prediction.status !== "failed") {
    await sleep(3000);
    const poll = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    prediction = await poll.json();
  }

  if (prediction.status === "failed") {
    throw new Error(prediction.error ?? "prediction failed");
  }

  const output = prediction.output;
  const url = Array.isArray(output) ? output[0] : output;
  if (typeof url !== "string") {
    throw new Error(`unexpected output shape: ${JSON.stringify(output)}`);
  }
  return url;
}

async function download(url: string, file: string): Promise<number> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} downloading ${file}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(file, bytes);
  return bytes.byteLength;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const plan = args.includes("--plan");
  const run = args.includes("--run");
  const capArg = args.find((a) => a.startsWith("--cap="));
  const cap = capArg ? Number(capArg.slice("--cap=".length)) : 25;
  const only = args.filter((a) => !a.startsWith("--"));

  const jobs = only.length ? JOBS.filter((j) => only.includes(j.id)) : JOBS;
  const total = jobs.reduce((sum, j) => sum + estimate(j), 0);

  console.log(
    `${jobs.length} jobs, estimated $${total.toFixed(2)}, cap $${cap.toFixed(2)}`,
  );
  for (const job of jobs) {
    console.log(
      `  ${job.id.padEnd(20)} ${job.kind.padEnd(6)} ${job.category.padEnd(18)} $${estimate(job).toFixed(3)}`,
    );
  }

  if (!run || plan) {
    console.log("\n--plan only. Nothing sent.");
    return;
  }
  if (!TOKEN) throw new Error("REPLICATE_API_TOKEN is not set.");
  if (total > cap) {
    throw new Error(
      `Estimated $${total.toFixed(2)} exceeds the $${cap.toFixed(2)} cap. Raise --cap deliberately or cut jobs.`,
    );
  }

  mkdirSync(OUT, { recursive: true });

  let spent = 0;
  const results: Record<string, unknown>[] = [];

  for (const job of jobs) {
    const ext = job.kind === "image" ? "png" : "mp4";
    const file = path.join(OUT, `${job.id}.${ext}`);

    if (existsSync(file)) {
      console.log(`  = ${job.id} already on disk, skipped`);
      continue;
    }
    if (spent + estimate(job) > cap) {
      console.log(
        `  ! cap reached at $${spent.toFixed(2)}; stopping before ${job.id}`,
      );
      break;
    }

    const started = Date.now();
    try {
      const url =
        job.kind === "image"
          ? await replicate(PRO_IMAGE, {
              prompt: job.prompt,
              aspect_ratio: job.aspect,
              resolution: "2K",
              output_format: "png",
            })
          : await replicate(VIDEO_PRO, {
              prompt: job.prompt,
              aspect_ratio: job.aspect,
              resolution: "1080p",
              duration: job.seconds,
            });

      const bytes = await download(url, file);
      spent += estimate(job);
      results.push({
        id: job.id,
        kind: job.kind,
        category: job.category,
        prompt: job.prompt,
        file: path.relative(process.cwd(), file),
        bytes,
        estimatedUsd: estimate(job),
      });
      console.log(
        `  + ${job.id.padEnd(20)} ${(bytes / 1024).toFixed(0).padStart(6)} KB  ${((Date.now() - started) / 1000).toFixed(0)}s  spent $${spent.toFixed(2)}`,
      );
    } catch (error) {
      console.log(
        `  x ${job.id.padEnd(20)} ${error instanceof Error ? error.message.slice(0, 90) : error}`,
      );
    }
  }

  writeFileSync(
    path.join(OUT, "run.json"),
    JSON.stringify({ spentUsd: spent, results }, null, 2),
  );
  console.log(
    `\nSpent about $${spent.toFixed(2)} of the $${cap.toFixed(2)} cap.`,
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
