/**
 * Sprint 4.4 — the hero poster and four discovery clips.
 *
 * ## Why this is separate from `generate-marketing-assets.ts`
 *
 * That script regenerates the whole marketing library from scratch and is
 * pinned to the two models the product runs. This one produces five specific
 * assets and needs a model the product does not offer, for a reason worth
 * writing down:
 *
 * **`flux-dev` cannot make the hero.** Its `megapixels` input caps at 1, which
 * at 16:9 is 1344x768 — exactly the size of the asset being replaced, and
 * exactly why it is soft. `flux-1.1-pro-ultra` renders 4MP natively, so the
 * replacement is a genuine 2752x1536 rather than a 1344x768 upscaled and
 * relabelled. The manifest is explicit that upscaling and calling it a
 * replacement would defeat the point.
 *
 * ## The spending gate is the reason this file exists at all
 *
 * Every call is priced *before* it is made and checked against a hard ceiling.
 * A run that would cross the ceiling aborts before spending, not after. There
 * are no retry loops: one attempt per asset, and a failure stops the sprint so
 * a human decides what to do next. Repeatedly retrying a paid endpoint is how
 * a $0.86 sprint becomes a $20 one.
 *
 * The token is read from `.env.local` and passed to `fetch`. It is never
 * printed, never written to a file, and never included in an error message.
 *
 * Usage:  node scripts/generate-sprint44-assets.mjs [--dry-run]
 */

/* This is an operator script whose entire product is the ledger it prints to
   the terminal. The project's no-console rule is waived here rather than
   loosened globally — the same exemption `backup-production.mjs` takes. */
/* eslint-disable no-console */

import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const DRY_RUN = process.argv.includes("--dry-run");

/** Hard ceiling for this sprint, in USD. Authorised amount, not a target. */
const CEILING_USD = 1.5;

const OUT = resolve(process.cwd(), "public", "marketing");

/**
 * Pinned versions, resolved from the Replicate API on 2026-08-15.
 *
 * `wan-2.2-t2v-fast` is the same version `services/ai/providers/replicate.ts`
 * pins for `replicate/video-gen`, so the clips are literally the product's own
 * output. `flux-1.1-pro-ultra` is the exception explained above.
 */
const FLUX_ULTRA =
  "551f15a1f56b90795ed34e94f11efb17196a5145bf2ae58fbf2d7e7d8bb42aaf";
const WAN_VIDEO =
  "c483b1f7b892065bc58ebadb6381abf557f6b1f517d2ff0febb3fb635cf49b4d";

/**
 * Prices used for the pre-flight estimate.
 *
 * `flux-1.1-pro-ultra` is Replicate's published per-image price. The video rate
 * is deliberately pessimistic: `services/billing/model-costs.ts` carries
 * $0.020/s for this model, verified against a real invoice, but that was
 * measured at 480p. 720p costs more and the exact multiple is not published, so
 * this doubles it. Estimating high is the safe direction for a ceiling.
 */
const PRICE = {
  fluxUltraPerImage: 0.06,
  wanPerSecond720p: 0.04,
};

/** 81 frames at 16 fps — the model's recommended frame count. */
const FRAMES = 81;
const FPS = 16;
const CLIP_SECONDS = FRAMES / FPS;

function token() {
  const file = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of file.split(/\r?\n/)) {
    const match = line.match(/^\s*REPLICATE_API_TOKEN\s*=\s*"?([^"\n]*)"?\s*$/);
    if (match?.[1]) return match[1].trim();
  }
  throw new Error("REPLICATE_API_TOKEN is not set in .env.local");
}

/**
 * The hero.
 *
 * The brief asks for a bright, impactful focal subject; the manifest asks for
 * clean space in the upper third, because that is where the white headline
 * sits and the scrim there is only ~40%. Both at once means a luminous subject
 * placed low in the frame, which is also simply a better wide composition.
 */
const HERO = {
  name: "hero-poster",
  aspect: "16:9",
  prompt:
    "A luminous crystalline monolith of violet, electric blue and cyan light " +
    "suspended above a dark reflective plane, bright glowing core, volumetric " +
    "god rays fanning outward, soft atmospheric haze, subject positioned low " +
    "in the frame with clean uncluttered dark space across the upper third, " +
    "cinematic wide composition, premium studio lighting, high dynamic range, " +
    "ultra detailed, no text, no watermark, no logo, no people",
  seed: 41,
};

/**
 * Four clips, four genuinely different subjects.
 *
 * The grid exists to show range. Four variations on drifting particles would
 * fill it and demonstrate nothing — and drifting violet particles is precisely
 * what the two existing clips already are, so repeating that would make the
 * section worse, not larger.
 *
 * Every prompt is abstract, product or environment work: no named people, no
 * recognisable characters, no brands. That is a commercial-safety requirement
 * for a homepage, not a stylistic preference.
 */
const CLIPS = [
  {
    name: "made-video-3",
    concept: "fashion portrait, controlled camera move",
    prompt:
      "Slow orbital camera move around a faceless mannequin in an iridescent " +
      "violet and cyan structured garment, fabric catching rim light, dark " +
      "studio background, volumetric haze, editorial fashion lighting, " +
      "cinematic, no text, no watermark, no logo",
    seed: 101,
  },
  {
    name: "made-video-4",
    concept: "futuristic product advertisement",
    prompt:
      "A faceted glass bottle rotating slowly while levitating above a dark " +
      "reflective surface, violet and cyan gel lighting, refracted caustics " +
      "moving across the surface, seamless studio cyclorama, macro product " +
      "advertisement, cinematic, no text, no watermark, no logo",
    seed: 102,
  },
  {
    name: "made-video-5",
    concept: "surreal transformation",
    prompt:
      "Violet and cyan ink blooming through clear water and unfurling into " +
      "the shape of luminous wings, slow graceful expansion, deep black " +
      "background, high contrast, surreal, cinematic macro, no text, no " +
      "watermark, no logo",
    seed: 103,
  },
  {
    name: "made-video-6",
    concept: "stylized environment",
    prompt:
      "Slow vertical camera rise through a neon-lit rain-slick canyon city at " +
      "night, violet and cyan signage glow reflecting in wet stone, " +
      "volumetric fog, cinematic anamorphic, no text, no watermark, no logo",
    seed: 104,
  },
];

/** Running ledger. Nothing is spent without being added here first. */
const ledger = [];
const spent = () => ledger.reduce((total, row) => total + row.estimateUsd, 0);

function authorise(label, estimateUsd) {
  const after = spent() + estimateUsd;
  if (after > CEILING_USD) {
    throw new Error(
      `CEILING: ${label} would take the total to $${after.toFixed(2)}, ` +
        `over the $${CEILING_USD.toFixed(2)} authorised. Aborting before spending.`,
    );
  }
  return after;
}

async function predict(version, input, label, estimateUsd) {
  const after = authorise(label, estimateUsd);
  process.stdout.write(
    `  ${label}: est $${estimateUsd.toFixed(3)} (running $${after.toFixed(3)}) ... `,
  );

  if (DRY_RUN) {
    ledger.push({ label, estimateUsd, status: "dry-run" });
    process.stdout.write("DRY RUN\n");
    return null;
  }

  const start = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({ version, input }),
  });

  if (!start.ok) {
    // Body may name the billing problem; it never contains the token.
    const detail = (await start.text()).slice(0, 300);
    ledger.push({ label, estimateUsd: 0, status: `HTTP ${start.status}` });
    throw new Error(`${label} failed: HTTP ${start.status} ${detail}`);
  }

  let job = await start.json();

  // `Prefer: wait` usually returns a settled prediction. Poll only if not.
  // Bounded: no unbounded loop against a paid endpoint.
  for (
    let i = 0;
    i < 120 && !["succeeded", "failed", "canceled"].includes(job.status);
    i++
  ) {
    await new Promise((r) => setTimeout(r, 2500));
    const poll = await fetch(job.urls.get, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    job = await poll.json();
  }

  if (job.status !== "succeeded") {
    ledger.push({ label, estimateUsd, status: job.status });
    throw new Error(
      `${label} did not succeed: ${job.status} ${String(job.error ?? "").slice(0, 200)}`,
    );
  }

  ledger.push({
    label,
    estimateUsd,
    status: "succeeded",
    predictTime: job.metrics?.predict_time ?? null,
  });
  process.stdout.write(
    `ok (${job.metrics?.predict_time?.toFixed(1) ?? "?"}s)\n`,
  );

  return Array.isArray(job.output) ? job.output[0] : job.output;
}

async function download(url, file) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`download ${file}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(resolve(OUT, file), bytes);
  return bytes.length;
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const estimate =
    PRICE.fluxUltraPerImage +
    CLIPS.length * CLIP_SECONDS * PRICE.wanPerSecond720p;

  console.log("Sprint 4.4 generation");
  console.log(`  ceiling            $${CEILING_USD.toFixed(2)}`);
  console.log(
    `  hero               1 x $${PRICE.fluxUltraPerImage.toFixed(3)}`,
  );
  console.log(
    `  clips              ${CLIPS.length} x ${CLIP_SECONDS.toFixed(2)}s x $${PRICE.wanPerSecond720p.toFixed(3)}/s`,
  );
  console.log(`  maximum estimate   $${estimate.toFixed(3)}`);
  if (estimate > CEILING_USD) {
    throw new Error("Estimate exceeds the ceiling. Nothing generated.");
  }
  console.log("");

  const produced = [];

  // ---- Hero -------------------------------------------------------------
  console.log("Hero poster");
  const heroUrl = await predict(
    FLUX_ULTRA,
    {
      prompt: HERO.prompt,
      aspect_ratio: HERO.aspect,
      output_format: "png",
      seed: HERO.seed,
      raw: false,
    },
    HERO.name,
    PRICE.fluxUltraPerImage,
  );
  if (heroUrl) {
    const size = await download(heroUrl, `${HERO.name}.source.png`);
    produced.push({ file: `${HERO.name}.source.png`, bytes: size });
  }

  // ---- Clips ------------------------------------------------------------
  console.log("\nClips");
  for (const clip of CLIPS) {
    const url = await predict(
      WAN_VIDEO,
      {
        prompt: clip.prompt,
        aspect_ratio: "9:16",
        resolution: "720p",
        num_frames: FRAMES,
        frames_per_second: FPS,
        seed: clip.seed,
        go_fast: true,
      },
      clip.name,
      CLIP_SECONDS * PRICE.wanPerSecond720p,
    );
    if (url) {
      const size = await download(url, `${clip.name}.mp4`);
      produced.push({
        file: `${clip.name}.mp4`,
        bytes: size,
        concept: clip.concept,
      });
    }
  }

  console.log("\n--- ledger ---");
  for (const row of ledger) {
    console.log(
      `  ${row.label.padEnd(16)} $${row.estimateUsd.toFixed(3)}  ${row.status}` +
        (row.predictTime ? `  ${row.predictTime.toFixed(1)}s` : ""),
    );
  }
  console.log(
    `  TOTAL ESTIMATE   $${spent().toFixed(3)} of $${CEILING_USD.toFixed(2)}`,
  );

  console.log("\n--- files ---");
  for (const p of produced) {
    const kb = statSync(resolve(OUT, p.file)).size / 1024;
    console.log(
      `  ${p.file.padEnd(26)} ${kb.toFixed(0)} KB${p.concept ? "  " + p.concept : ""}`,
    );
  }
}

main().catch((error) => {
  console.error("\nSTOPPED:", error.message);
  console.error(`Spent so far (estimate): $${spent().toFixed(3)}`);
  process.exit(1);
});
