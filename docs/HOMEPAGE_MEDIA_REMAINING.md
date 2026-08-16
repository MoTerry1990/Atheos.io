# Homepage media — audit and what is still needed

Every image on the homepage, measured: source dimensions from the file, maximum
rendered dimensions from the live page, and a keep-or-replace decision against
a **2× density** rule.

**Six replacements needed.** Two are urgent — they are under-resolved _and_
badly cropped. Four are quality replacements. Nothing on this page is fake, and
nothing was upscaled and relabelled.

---

## How the numbers were taken

- **Source** — read from the WebP headers in `public/marketing/`.
- **Rendered** — measured in a browser on the production build, at the viewport
  where each element is largest. The layout is capped at `max-w-7xl` (1280px),
  so nothing grows past a 1440px viewport.
- **Effective source** — what survives `object-cover`. A 1344×768 landscape
  image in a 4:5 portrait card does not contribute 1344 pixels of width; it
  contributes the 614×768 rectangle that fits the crop. **This is the number
  that matters**, and it is where the two urgent failures are.
- **Needed** — rendered × 2.

---

## The audit

> **Updated 2026-08-15 (Sprint 4.4).** `hero-poster` and `auth-poster` have left
> this table. The hero poster was regenerated at 2752×1536 / 90 KB and is no
> longer a gallery asset; `auth-poster` went back to being only the auth panel's
> poster. The two gallery slots they occupied are now `made-video-*` clips.
>
> The four new posters replace them as the open items, for a smaller and more
> specific reason. `wan-2.2-t2v-fast` offers 9:16 or 16:9 and nothing between,
> and tops out at 720p, so a 720×1280 frame put into a 4:5 tile yields 720×900
> where the rule wants 786×982 — **92% of the floor, against the 78% the old
> hero poster managed.** Better, still short, still recorded. Clearing it needs
> a model that emits 4:5 or ≥1080p portrait, not a re-encode of these.

| File                   | Source    | Max rendered | Effective source | Needed @2× | Verdict                                                              |
| ---------------------- | --------- | ------------ | ---------------- | ---------- | -------------------------------------------------------------------- |
| `made-video-3.webp`    | 720×1280  | 393×491      | 720×900          | 786×982    | **REPLACE — 92% of the 2× floor; 9:16 model output into a 4:5 tile** |
| `made-video-4.webp`    | 720×1280  | 393×491      | 720×900          | 786×982    | **REPLACE — as above**                                               |
| `made-video-5.webp`    | 720×1280  | 393×491      | 720×900          | 786×982    | **REPLACE — as above**                                               |
| `made-video-6.webp`    | 720×1280  | 393×491      | 720×900          | 786×982    | **REPLACE — as above**                                               |
| `gallery-2.webp`       | 1024×1024 | 393×491      | 819×1024         | 786×982    | Keep — resolution adequate                                           |
| `gallery-4.webp`       | 1024×1024 | 393×491      | 819×1024         | 786×982    | Keep — resolution adequate                                           |
| `gallery-5.webp`       | 1024×1024 | 393×491      | 819×1024         | 786×982    | Keep — resolution adequate                                           |
| `gallery-8.webp`       | 1024×1024 | 393×491      | 819×1024         | 786×982    | Keep — resolution adequate                                           |
| `showcase-image.webp`  | 1152×896  | 576×432      | 1152×864         | 1152×864   | Keep — exactly adequate                                              |
| `showcase-video.webp`  | 1152×896  | 576×432      | 1152×864         | 1152×864   | Keep                                                                 |
| `showcase-audio.webp`  | 1152×896  | 576×432      | 1152×864         | 1152×864   | Keep                                                                 |
| `feature-library.webp` | 1344×768  | 536×210      | 1344×735         | 1072×420   | Keep                                                                 |
| `feature-craft.webp`   | 1344×768  | 536×210      | 1344×735         | 1072×420   | Keep                                                                 |
| `template-1…6.webp`    | 1152×896  | 393×294      | 1152×864         | 786×588    | Keep                                                                 |

### The compression problem, separately from resolution

Several files clear the dimension rule and still look soft, because they were
written at a very low bitrate:

| File                   | Size   | At 1024×1024 that is                                                                       |
| ---------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `template-2.webp`      | 8 KB   | severe                                                                                     |
| `gallery-1.webp`       | 9 KB   | severe                                                                                     |
| `template-1.webp`      | 10 KB  | severe                                                                                     |
| `feature-craft.webp`   | 11 KB  | severe                                                                                     |
| `gallery-6.webp`       | 14 KB  | heavy                                                                                      |
| `gallery-3.webp`       | 18 KB  | heavy                                                                                      |
| `feature-library.webp` | 125 KB | fine — and the same dimensions as `feature-craft` at 11× the bytes, which is the disparity |

**Fixed in code, as far as code can:** `GeneratedImage` now requests
`quality={90}` instead of Next's default 75. The site was re-encoding an
already-compressed source, and compounded lossy compression is exactly what
soft, smeared gradients look like. Total page weight went 509 KB → 672 KB;
Lighthouse desktop Performance 100 → 99.

**Not fixable in code:** detail that was thrown away when the file was written
cannot be recovered. The six files below need regenerating.

---

## Replacements needed

### 1–2. Gallery video cards — **urgent**

`hero-poster` and `auth-poster` are doing double duty: they are the hero
background and the sign-in panel, _and_ two of the six "Made with Atheos"
cards. `hero.mp4` is landscape in a portrait card, which is the worst crop on
the page.

Replace with four purpose-made portrait clips:

| Property          | Requirement                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| **Filenames**     | ~~`made-1.mp4` … `made-4.mp4`~~ → **delivered as `made-video-3` … `made-video-6`** (`.mp4` + `.webm`)         |
| **Posters**       | ~~`made-1-poster.webp` …~~ → **delivered as `made-video-3.webp` … `made-video-6.webp`**, frame 0 of each clip |
| **Orientation**   | **Portrait 9:16**                                                                                             |
| **Dimensions**    | **1080×1920** preferred, 720×1280 minimum                                                                     |
| **Poster dims**   | Identical to the clip                                                                                         |
| **Duration**      | 4–8 seconds, seamless loop                                                                                    |
| **Frame rate**    | 16–24 fps                                                                                                     |
| **Formats**       | MP4 (H.264, `yuv420p`, `+faststart`) **and** WebM (VP9)                                                       |
| **Poster format** | WebP, quality 82–88, **60–110 KB** — not 13 KB                                                                |
| **Max size**      | 1.5 MB MP4, 1.0 MB WebM                                                                                       |
| **Audio**         | **None.** Strip it — the cards are muted                                                                      |
| **Placement**     | `MADE_WITH_ATHEOS` in `features/marketing/content.ts`                                                         |
| **Type**          | **Video** (original generation required)                                                                      |

> **DELIVERED — Sprint 4.4.** All four clips exist. Generated with the pinned
> `wan-2.2-t2v-fast` version (the same one `replicate/video-gen` resolves to),
> 720×1280, 5.07 s, 24 fps, no audio track, four distinct subjects: fashion,
> product, surreal, environment. Total paid generation $0.81 of an authorised
> $1.50.
>
> Two lines of this spec were **not** met, and the row above the table records
> why: the model tops out at **720p** where this asked for 1080×1920 preferred,
> and it emits only 9:16 or 16:9, so the 4:5 tile still crops. Sizes came in
> well under budget (482–1048 KB MP4, 342–563 KB WebM against 1.5 MB / 1.0 MB).
>
> Filenames follow `docs/MEDIA_REPLACEMENT_MANIFEST.md`, which this section
> predates and disagrees with; the manifest is the one the sprint brief points
> at, so it won.

### 3–6. The four weakest stills — quality replacements

Same dimensions, written at a proper bitrate.

| File                                 | Replace with           | Format | Compression        | Placement     | Type  |
| ------------------------------------ | ---------------------- | ------ | ------------------ | ------------- | ----- |
| `gallery-1.webp`                     | 1024×1280 **portrait** | WebP   | q 82–88, 90–140 KB | Gallery card  | Image |
| `gallery-3.webp`                     | 1024×1280 **portrait** | WebP   | q 82–88, 90–140 KB | Gallery card  | Image |
| `template-1.webp`, `template-2.webp` | 1152×896               | WebP   | q 82–88, 60–100 KB | Templates row | Image |

Portrait for the gallery replacements: the cards are 4:5, and a native 4:5
source wastes no pixels on a crop.

---

## Visual direction for the new assets

The current set is repetitive abstract darkness — drifting particles, chrome,
neon rain, jellyfish. Four of six gallery cards are dark abstracts. That reads
as one mood rather than a range, and it hides exactly the detail that would
convince somebody the output is good.

**Keep** the Atheos palette: deep near-black grounds, blue and cyan highlights.
**Change** the subject mix and the exposure.

- **Brighter focal subjects.** A clearly lit subject against a dark ground, not
  a dark subject in a dark room.
- **Richer blue/cyan highlights** — specular edges, rim light, reflections that
  actually read as light rather than as grey.
- **Stronger contrast and depth.** Cinematic, not almost-black.
- **Varied subjects.** Aim for roughly: one person, one product, one
  environment, one motion study. Not four abstracts.

Suggested prompt directions:

1. **Person** — editorial portrait, cyan rim light against a warm key, shallow
   depth of field, visible skin and fabric texture.
2. **Product** — a matte object on a seamless dark backdrop, one strong
   specular highlight, controlled reflections.
3. **Environment** — an architectural interior at blue hour, practical lights
   in frame, deep perspective.
4. **Motion** — liquid or fabric caught mid-movement, bright core, dark
   surround.

Avoid legible text (models render it badly), recognisable faces, and brand
marks.

---

## Producing them

```bash
npx dotenv-cli -e .env.local -- npx tsx scripts/generate-marketing-assets.ts
```

Transcode a clip to WebM:

```bash
ffmpeg -i public/marketing/made-1.mp4 -c:v libvpx-vp9 -crf 34 -b:v 0 -row-mt 1 -an public/marketing/made-1.webm
```

Pull a poster at a proper quality — **`-q:v 85`, not the default**:

```bash
ffmpeg -i public/marketing/made-1.mp4 -frames:v 1 -q:v 85 public/marketing/made-1-poster.webp
```

Confirm faststart and no audio track:

```bash
ffmpeg -i public/marketing/made-1.mp4 -c copy -movflags +faststart -an public/marketing/made-1.fixed.mp4
```

---

## Wiring them in

One array, `MADE_WITH_ATHEOS` in `features/marketing/content.ts`:

```ts
{
  kind: "video",
  poster: "made-1",
  video: "/marketing/made-1.mp4",
  prompt: "…the exact prompt that produced it…",
  model: "Motion 1",
},
```

- `poster` is the basename **without** extension.
- `prompt` must be the real prompt — it is rendered on the card and carried
  into the studio by "Try this".
- `model` is optional and must be **omitted rather than guessed**.
  `tests/unit/homepage-sections.test.ts` asserts the shape.

Nothing else changes. The grid, lazy loading, play-one-at-a-time and the
reduced-motion fallback all read from that array.

---

## What was done meanwhile, and what was refused

**Done:** the hero's three stacked scrims were reduced to one. A flat
`bg-background/70`, a `from-background/60` gradient and a 60% brand tint
compounded to roughly **88% obscuration** at the top of the frame — the
artwork behind the headline was effectively invisible. It is now a single
gradient, light where the art is and heavy at the bottom where the section
dissolves into the page. Lighthouse's contrast audit still passes at 100.

**Refused:**

- No stock footage. Atheos sells generation; a landing page filmed by somebody
  else disproves its own claim.
- No competitor media, hotlinked or copied.
- No image labelled as a video, and no clip repeated to fill the grid.
- No upscaling a small original and calling it high resolution.
- Nothing claimed as generated by Atheos that was not.

**Honest placeholder policy:** the two reused clips stay until replacements
exist. They are genuine Atheos output, each card shows its real prompt and
model, and the grid is full at every breakpoint — so the page reads as
intentional rather than unfinished. What they are not is _distinct_, and this
document is the record of that.
