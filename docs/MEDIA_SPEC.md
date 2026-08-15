# Media specification — marketing site

What the homepage expects, so a replacement asset drops in without a code
change. Everything under `public/marketing/`.

---

## What exists today

| File                                |      Size | Format | Used by                             |
| ----------------------------------- | --------: | ------ | ----------------------------------- |
| `hero.mp4`                          |  1,310 KB | H.264  | Hero background                     |
| `hero.webm`                         |    720 KB | VP9    | Hero background (preferred)         |
| `hero-poster.webp`                  |     13 KB | WebP   | Hero, and a Made-with card          |
| `auth.mp4`                          |  3,415 KB | H.264  | Sign-in panel, and a Made-with card |
| `auth.webm`                         |  1,839 KB | VP9    | Sign-in panel (preferred)           |
| `auth-poster.webp`                  |      5 KB | WebP   | As above                            |
| `gallery-1…8.webp`                  |   9–68 KB | WebP   | Made with Atheos, feature cards     |
| `template-1…6.webp`                 |   8–40 KB | WebP   | Templates                           |
| `showcase-{image,video,audio}.webp` |  34–72 KB | WebP   | Showcase tabs                       |
| `feature-{library,craft}.webp`      | 11–125 KB | WebP   | Benefit cards                       |

Every one was produced by `scripts/generate-marketing-assets.ts` on the same
pinned model versions the product runs. That is what makes "real creations"
on the gallery an accurate claim rather than a marketing one.

---

## What is missing

**Four gallery video clips.**

`MADE_WITH_ATHEOS` in `features/marketing/content.ts` currently holds two
videos and four images. The two videos are `hero.mp4` and `auth.mp4`, both of
which already appear elsewhere on the site.

They were not generated because the Replicate account is out of credit. They
were not faked by repeating a clip or by labelling an image as a video, because
the section's entire premise is that its contents are genuine.

### Required specification

| Property              | Value                                                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filenames**         | `made-1.mp4` … `made-4.mp4`, plus `made-1.webm` … `made-4.webm`                                                                                                                         |
| **Posters**           | `made-1-poster.webp` … `made-4-poster.webp` — **required**                                                                                                                              |
| **Directory**         | `public/marketing/`                                                                                                                                                                     |
| **Container / codec** | MP4 (H.264, yuv420p) and WebM (VP9). WebM is listed first; MP4 is the Safari fallback                                                                                                   |
| **Resolution**        | 720×1280 or 1080×1920                                                                                                                                                                   |
| **Aspect ratio**      | **9:16 portrait** — the cards are `aspect-[4/5]` and a landscape clip crops badly. `auth.mp4` is the only portrait clip today, which is why it reads better in the grid than `hero.mp4` |
| **Duration**          | 4–8 seconds, seamless loop                                                                                                                                                              |
| **Max file size**     | **1.5 MB** MP4, **1.0 MB** WebM                                                                                                                                                         |
| **Audio**             | **None.** Strip it — the cards are muted and an audio track is bytes nobody hears                                                                                                       |
| **Frame rate**        | 16–24 fps                                                                                                                                                                               |
| **`+faststart`**      | Required, so playback begins before the file finishes downloading                                                                                                                       |

### Producing them

```bash
npx dotenv-cli -e .env.local -- npx tsx scripts/generate-marketing-assets.ts
ffmpeg -i public/marketing/made-1.mp4 -c:v libvpx-vp9 -crf 34 -b:v 0 \
  -row-mt 1 -an public/marketing/made-1.webm
```

### Wiring them in

Only `MADE_WITH_ATHEOS` changes. Swap an image entry for:

```ts
{
  kind: "video",
  poster: "made-1-poster",
  video: "/marketing/made-1.mp4",
  prompt: "…the prompt that produced it…",
  model: "Motion 1",
}
```

`model` is optional and must be **omitted rather than guessed**. A card
claiming to be real output with an invented model name attached undoes the
point of the section, and `homepage-sections.test.ts` asserts the shape.

---

## Rules that apply to every asset here

- **No stock footage.** Atheos sells generation; a landing page filmed by
  somebody else disproves its own claim.
- **No competitor assets, hotlinked or copied.**
- **Never label an image as a video**, and never repeat one clip to fill a grid.
- **Never claim Atheos generated something it did not.** If an asset's origin
  is unverified, it does not belong in "Made with Atheos".
- **A poster is mandatory for every video.** It is what the reader sees before
  playback, under reduced motion, and when autoplay is refused.

---

## Loading behaviour, as built

| Surface          | Behaviour                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Hero video       | `preload="none"`, plays after paint, suppressed entirely under `prefers-reduced-motion`                                 |
| Gallery videos   | **No `<source>` until within 200 px of the viewport.** Never autoplay. One plays at a time; leaving the viewport pauses |
| Auth panel video | Desktop only — gated on `min-width: 1024px`, so phones never fetch its 3.4 MB                                           |
| All images       | `next/image`, lazy by default, explicit `sizes`                                                                         |
| Aspect ratios    | Reserved on the container, so no media load moves the page                                                              |
