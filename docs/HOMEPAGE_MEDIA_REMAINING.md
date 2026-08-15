# Homepage media still needed from you

Four portrait video clips. Everything else on the homepage is present and
correct.

This is the complete specification — filenames, dimensions, duration, formats,
posters and placement — so the assets drop in with a six-line code change and
no guessing.

---

## What is missing, and what the page does meanwhile

The "Made with Atheos" gallery has six cards. Four are genuine generated
stills. The remaining two are video cards, and they currently play
**`hero.mp4`** and **`auth.mp4`** — clips that already appear elsewhere on the
site, as the hero background and the sign-in panel.

That is not a false claim. Both were produced by
`scripts/generate-marketing-assets.ts` on the same pinned models the product
runs, and each card shows the prompt and the model that made it. But they are
**reused**, so a reader who scrolls the page sees the same footage twice in two
different roles, and the gallery is quietly proving a narrower point than it
appears to.

Deliberately **not** done to paper over it:

- No duplicated clip padded out to four cards.
- No still image labelled as a video.
- No stock footage, and nothing downloaded from a competitor.
- No invented model name on a card.

The page looks intentional as it stands — six cards, a full grid at every
breakpoint, every card carrying a real prompt. Replacing the two reused clips
is an improvement, not a repair.

---

## The four clips

| Property              | Requirement                                                                    |
| --------------------- | ------------------------------------------------------------------------------ |
| **Filenames**         | `made-1.mp4` … `made-4.mp4` **and** `made-1.webm` … `made-4.webm`              |
| **Posters**           | `made-1-poster.webp` … `made-4-poster.webp` — **mandatory, one per clip**      |
| **Directory**         | `public/marketing/`                                                            |
| **Aspect ratio**      | **9:16 portrait**                                                              |
| **Dimensions**        | **720 × 1280** (preferred) or 1080 × 1920                                      |
| **Poster dimensions** | Identical to the clip — 720 × 1280 or 1080 × 1920                              |
| **Duration**          | **4–8 seconds**, seamless loop                                                 |
| **Frame rate**        | 16–24 fps                                                                      |
| **Video codecs**      | MP4 = H.264, `yuv420p`. WebM = VP9                                             |
| **Max file size**     | **1.5 MB** per MP4, **1.0 MB** per WebM, **60 KB** per poster                  |
| **Audio**             | **None — strip it.** The cards are muted; an audio track is bytes nobody hears |
| **`+faststart`**      | Required on the MP4, so playback begins before the file finishes downloading   |

### Why 9:16

The cards are `aspect-[4/5]`. A landscape clip crops to a letterboxed strip
across the middle. `auth.mp4` is the only portrait clip on the site today,
which is why it reads better in the grid than `hero.mp4` does — that difference
is visible on the live page right now.

### Why both formats

WebM is listed first and serves everyone except Safari, at roughly two-thirds
the bytes. MP4 is the fallback. Shipping only MP4 costs about 50% more
bandwidth on most visits; shipping only WebM breaks the gallery on iPhone.

---

## Producing them

```bash
npx dotenv-cli -e .env.local -- npx tsx scripts/generate-marketing-assets.ts
```

Then transcode each one:

```bash
ffmpeg -i public/marketing/made-1.mp4 -c:v libvpx-vp9 -crf 34 -b:v 0 -row-mt 1 -an public/marketing/made-1.webm
```

And pull a poster from the first frame:

```bash
ffmpeg -i public/marketing/made-1.mp4 -frames:v 1 -q:v 80 public/marketing/made-1-poster.webp
```

Check the MP4 has `+faststart` and no audio:

```bash
ffmpeg -i public/marketing/made-1.mp4 -c copy -movflags +faststart -an public/marketing/made-1.fixed.mp4
```

---

## Where they go

One file, one array: `MADE_WITH_ATHEOS` in `features/marketing/content.ts`.

Replace the two entries whose `poster` is `hero-poster` and `auth-poster`, and
add two more, so the gallery ends with **four videos and four images** across
eight cards:

```ts
{
  kind: "video",
  poster: "made-1",
  video: "/marketing/made-1.mp4",
  prompt: "…the exact prompt that produced it…",
  model: "Motion 1",
},
```

- `poster` is the basename **without** extension — the component appends it.
- `prompt` must be the real prompt. It is rendered on the card and it is what
  the "Try this" button carries into the studio.
- `model` is optional and must be **omitted rather than guessed**. A card
  claiming to be real output with an invented model attached undoes the point
  of the whole section, and `tests/unit/homepage-sections.test.ts` asserts the
  shape.

Nothing else changes. The grid, the lazy loading, the play-one-at-a-time
behaviour and the reduced-motion fallback all work off that array.

---

## Suggested subjects

Four clips that are visibly different from each other, so the grid reads as a
range rather than a mood board. These are suggestions, not requirements:

1. **Product** — a slow orbit around an object on a seamless backdrop.
2. **Nature** — water, smoke or cloth in motion, close.
3. **Character** — a figure, mid-shot, small movement.
4. **Abstract** — light, particles or liquid, the one that can be pure colour.

Avoid anything with legible text (models render it badly), recognisable faces,
and brand marks.

---

## Rules that apply to every asset on this page

- **No stock footage.** Atheos sells generation; a landing page filmed by
  somebody else disproves its own claim.
- **No competitor assets**, hotlinked or copied.
- **Never label an image as a video**, and never repeat one clip to fill a grid.
- **Never claim Atheos generated something it did not.** If an asset's origin is
  unverified, it does not belong in "Made with Atheos".
- **A poster is mandatory for every video.** It is what the reader sees before
  playback, under reduced motion, and when autoplay is refused — which on the
  homepage is always, because these cards never autoplay.
