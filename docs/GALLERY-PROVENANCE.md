# Gallery provenance — "Made with Atheos"

Where every card in the home page gallery came from, and what was rejected.

## The rule

The section is called "Made with Atheos". A card in it must be output from a
model the product runs, generated through the product's own pinned model
versions. `/content-details` tells visitors that nothing on the site is stock
footage and that nothing was taken from anywhere else, so a single borrowed
asset here makes that page false.

Everything below exists because the honest answer to "can we fill thirty cards
from what we already have" turned out to be no, and the ways of pretending
otherwise were all available and all wrong.

## What was audited, and what was rejected

| Source                                         | Found                        | Verdict                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets` table / R2 (real product generations) | 15 images, 24 videos         | **Partly used.** 39 assets, but only ~4 distinct image subjects and ~10 distinct video prompts — five near-identical dragons, five near-identical red convertibles, three paper boats.                                                                                                                     |
| Desktop `broll/` (74 clips)                    | 1080p stock footage          | **Rejected — not ours.** `broll/manifest.json` records a `videos.pexels.com` source URL for every clip, and `stock-footage-shotlist.md` opens "Free stock B-roll shot list (replaces Higgsfield generation)". Licensed for commercial use, but presenting it as Atheos output is a false authorship claim. |
| Desktop `broll/ai-stills/` (38 stills)         | Roman history, Dreamina-made | **Rejected — not ours, and one subject.** Generated for a different project on a different platform.                                                                                                                                                                                                       |
| Desktop `graphics/` (76 PNGs)                  | Programmatic info cards      | **Rejected — not creative output.**                                                                                                                                                                                                                                                                        |
| `public/marketing/gallery-*.webp`              | 8 stills at 1024×1024        | **Rejected — under the 1600 px floor.**                                                                                                                                                                                                                                                                    |
| `public/marketing/made-video-*.mp4`            | 4 clips at 720×1280          | **Retired.** Two were already withdrawn for near-zero motion; the other two are on the removal list for this sprint.                                                                                                                                                                                       |
| Two "2K" legacy stills                         | 2048×2048 and 1536×2688      | **Rejected — upscales, not captures.** Both are `replicate/real-esrgan` 2× upscales of 1024² originals (`operation: UPSCALE`, `scale: 2`). The pixel count clears the floor; the detail does not exist.                                                                                                    |

Nine video prompts among the product generations were also rejected for
third-party branding (Apple TV, iPhone, AirPods in the prompt) and eight for
being presenter script fragments rather than creative work.

## What was generated

`scripts/generate-gallery-assets.ts`, run by hand against the live Replicate
account on 2 September 2026. Pinned model versions, matching
`services/ai/providers/replicate.ts` exactly: `nano-banana-pro` for images at
2K, `video-pro` for video at 1080p.

Authorised ceiling **$25**. The script prices the whole run before sending
anything and refuses to start above the cap.

| Ran                    | Cost      |
| ---------------------- | --------- |
| 16 images at 2K        | $2.40     |
| 2 videos at 1080p / 5s | $0.54     |
| **Spent**              | **$2.94** |

Every generated image landed between 1696 and 2752 px on the long edge, so all
sixteen clear the 1600 px floor natively rather than by upscaling.

**One job did not run.** `vid-nature-01` was refused by Replicate with
`402 Insufficient credit` — the account balance is exhausted, not the cap. See
"What is missing" below.

## What is on the page

26 cards: 16 images and 10 videos, listed in
`media-source/gallery-selection.json` and built into
`features/marketing/gallery.generated.ts` by
`scripts/build-gallery-media.mjs`. Every entry records the SHA-256 of the
master it came from; the masters live in `media-source/` and are gitignored.

Derivatives, exactly as for the hero: the master is never overwritten, the
published file is a re-encode, and the two are linked by hash. Posters are a
single 1280w WebP that `next/image` resizes down from; clips are H.264 capped
at 1280 on the long edge, CRF 32, audio stripped. 36 files, 7.3 MB total.

## Reconciliation

Two counts were reported during this sprint and they did not agree. The first —
"18 images and 11 videos" — was taken before two things were discovered: that
the two 2048 px legacy stills are `real-esrgan` upscales rather than captures,
and that several videos shared a prompt or a subject with another. Recounted
from the files themselves:

| Included  | Count | Source                         | Native dimensions      |
| --------- | ----- | ------------------------------ | ---------------------- |
| Images    | 16    | all generated 2 Sep 2026       | 1696–2752 px long edge |
| Videos    | 10    | 2 generated, 8 product history | 720×1280 to 1920×1088  |
| **Total** | 26    |                                | 26 distinct SHA-256    |

31 further candidates were examined and rejected: Pexels stock, off-platform
stills, programmatic cards, sub-floor legacy images, upscales, third-party
branding in the prompt, presenter script fragments, and repeated prompts or
subjects. The per-asset record is `media-source/reconciliation.json`.

**Deficit against 18 images / 12 videos / 30 total: 2 images, 2 videos, 4
cards.** At $0.150 an image and $0.270 a five-second video that is **$0.84** —
which is why exactly four jobs remain staged, and not one more.

Duplicate spending is prevented by the asset id being the output filename:
`generate-gallery-assets.ts` skips any job whose file already exists, so the 18
already produced can never be paid for twice.

## What is missing

**Four cards, and about $0.84 of Replicate credit.**

`tests/unit/gallery.test.ts` requires 30 cards, 18 images and 12 videos and
currently fails on both counts. That is deliberate: the count is the claim the
section makes, and a gate that passes at 26 would be a gate that lets the
section quietly shrink again — which is exactly how it stayed at six cards for
several sprints.

To close it: top up the Replicate account, then

```bash
npx dotenv-cli -e .env.local -- npx tsx scripts/generate-gallery-assets.ts --run
```

which will run only the jobs whose output is not already on disk — two more
images and one more video, about $0.84 — followed by
`node scripts/build-gallery-media.mjs`.

## Why the count was not simply reached with what was there

There are two more red-convertible clips in the library with prompts distinct
enough to pass the no-repeated-prompts rule. Adding them would have made the
number, and the page would then have carried four red-car videos including the
hero. "Duplicate or almost identical content" is a rejection criterion for this
gallery, and a gallery that meets its target by repeating itself has not met
it.
