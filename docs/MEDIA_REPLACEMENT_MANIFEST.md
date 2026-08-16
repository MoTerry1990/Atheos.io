# Media replacement manifest

Production specifications for the homepage assets that must be replaced or
created. Hand this to whoever produces them; every field is decided.

**This file does not repeat the audit.** `docs/HOMEPAGE_MEDIA_REMAINING.md`
holds the measurements and the verdicts, and `tests/unit/homepage-media.test.ts`
enforces that any asset failing the density rule is named there. This is the
other half: what to make, exactly.

Re-measured against production `dpl_9vm7ChUpH5sfCZBbk2UbzvZfxyax` on 2026-08-15;
the audit's REPLACE verdicts were independently reproduced, and one new fact was
added — the hero poster is the confirmed LCP element.

---

## 1. `hero-poster.webp` — highest priority

The audit marks this REPLACE on two counts: under-resolved, and a landscape
image cropped into a portrait card. Production measurement adds a third, which
promotes it above everything else here.

**It is the LCP element.** Lighthouse resolves the largest contentful paint to
the `bg-cover` div in `hero-video.tsx`, painted at **1340 × 622** behind the
headline. So this asset is simultaneously the first thing rendered, the largest
surface on the page, a 1× file in a 2× slot, _and_ — at 13 KB for its pixel
count — compressed hard enough that the audit calls it "severe, and it is the
first thing anybody sees".

That combination is the whole of "the media looks dark and insufficiently
impactful". It is one file.

| Field         | Value                                                                      |
| ------------- | -------------------------------------------------------------------------- |
| Filename      | `hero-poster.webp` (replace in place)                                      |
| Dimensions    | **2880 × 1340** minimum                                                    |
| Aspect ratio  | **2.15** — framed for the wide hero crop, not 1.75                         |
| Format        | WebP, **quality 82–88** (the current file is far below this)               |
| Max file size | **180 KB**                                                                 |
| Composition   | Interest in the central 60% vertically; top and bottom crop at some widths |
| Brightness    | Mid-tones no darker than ~35% luma — it sits under a 40% scrim             |
| Must match    | Frame 0 of `hero.mp4`, same seed. It cross-fades to that clip              |

It is also used as a gallery poster at 4:5, where it loses 54% of its width.
That reuse ends when §2 lands.

**Do not lighten the scrim instead.** It is a single gradient, already reduced
from a compounded ~88% in Sprint 4.2, and colour contrast currently scores 100
with it in place. Trading a measured accessibility guarantee for a marginal
brightness gain on an asset that is soft anyway is the wrong exchange. Replace
the asset.

---

## 2. Four portrait clips for the discovery grid

`features/marketing/content.ts` has said this since the section was built:
`hero.mp4` and `auth.mp4` are the entire committed video library, both are
already used, and the grid runs 2 video cards against 6 image cards.

**These are not placeholders awaiting stock.** The section's premise is that
every tile is genuine Atheos output shown with its prompt. A licensed clip there
would make the section a lie. Fewer video cards, all real, is the correct state
until real clips exist.

Blocked on Replicate credit. Not generated — paid generation is not authorised.

| Field             | Value                                                            |
| ----------------- | ---------------------------------------------------------------- |
| Filenames         | `made-video-3.mp4` … `made-video-6.mp4`                          |
| Companion posters | `made-video-3.webp` … `made-video-6.webp`                        |
| Dimensions        | **1080 × 1350**                                                  |
| Aspect ratio      | **0.80** — matches `aspect-[4/5]` exactly, so nothing crops      |
| Duration          | **4–6 s**, seamless loop                                         |
| Frame rate        | 24 or 30 fps                                                     |
| Format            | H.264 MP4 **and** VP9 WebM (the grid negotiates by source order) |
| Max file size     | **1.2 MB** MP4, **700 KB** WebM                                  |
| Audio             | **None.** Strip the track — absent, not silent                   |
| Poster            | WebP q82–88, **2160 × 2700**, max 220 KB                         |
| Poster content    | Frame 0 of its own clip. Not a lookalike still                   |

**Each clip visually distinct.** Four variations on drifting violet particles
would fill the grid and demonstrate nothing; the section exists to show range.
Suggested spread: one product/object, one architectural or landscape, one
portrait or character, one material or abstract study.

---

## 3. `auth-poster.webp`

REPLACE per the audit — marginally under-resolution (768 wide against 786
needed) and reused from the auth panel. Superseded by §2: once the video tiles
have purpose-framed 0.80 posters, this stops being a gallery asset and goes back
to being only what it is, the auth panel poster.

No new spec needed. If §2 is deferred, re-cut it to **2160 × 2700**, WebP q82–88,
max 220 KB.

---

## Rules for every replacement

- **No upscaling.** A 1024 px source resampled to 2880 px is not a 2880 px
  asset, and recording it as one here would defeat the file.
- **No stock, no competitor media.** Atheos output or it does not ship.
- **No duplicates.** One clip must never appear twice under two prompts. The
  gallery currently has zero byte-identical duplicates —
  `tests/unit/homepage-media.test.ts` asserts no poster repeats, and that must
  stay true.
- **Record the prompt** in `content.ts` beside the asset. A card claiming real
  output has to show its working.
- **Verify after landing.** Re-run the audit in
  `docs/HOMEPAGE_MEDIA_REMAINING.md`, confirm every asset clears its 2× floor,
  and update the verdicts there — not here.
