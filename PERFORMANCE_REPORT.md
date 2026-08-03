# Performance Report — Sprint 16

**Scope:** performance optimization.
**Baseline:** the eleven bottlenecks in `PROJECT_AUDIT.md` § Performance Review.

---

## Read this first: the headline number went the wrong way

JavaScript on the seven image-carrying routes went **up** by 5–6 kB.

| Route                | Before | After  | Δ         |
| -------------------- | ------ | ------ | --------- |
| `/explore`           | 152 kB | 157 kB | **+5 kB** |
| `/p/[slug]`          | 152 kB | 157 kB | **+5 kB** |
| `/u/[handle]`        | 151 kB | 157 kB | **+6 kB** |
| `/projects`          | 200 kB | 206 kB | **+6 kB** |
| `/projects/[id]`     | 152 kB | 158 kB | **+6 kB** |
| `/projects-preview`  | 207 kB | 213 kB | **+6 kB** |
| `/community-preview` | 164 kB | 169 kB | **+5 kB** |
| **Shared**           | 102 kB | 102 kB | 0         |
| Every other route    | —      | —      | 0         |

That is `next/image`'s client runtime, and it is the price of the change the
audit called the single biggest available win: those routes previously served
**full-size original images** through a raw `<img>`.

The trade is 6 kB of JavaScript against image bytes that are routinely 10–100×
larger. A gallery tile is a ~320 px box; before this sprint it was filled with
whatever the generator produced, commonly 1024–2048 px. One tile at 2048 px is
several hundred kB; the AVIF variant for a 320 px box is tens of kB. At 24 tiles
the arithmetic is not close.

**But I have not measured that saving, and I will not claim it.** No fixture in
this repository supplies a cover image, so no `<Image>` in this codebase has
ever rendered. The conversion is verified by typecheck and build only. See
"What could not be measured".

---

# What was changed

## 1. Images — the raw `<img>` tags are gone

Five components rendered raw `<img>`, each carrying an eslint-disable and the
same justification:

> Asset hosts are per-deployment, so next/image would need every possible R2
> hostname in remotePatterns at build time.

That was true of _every possible_ host and false of _this_ one. The bucket's
public URL is `NEXT_PUBLIC_R2_PUBLIC_URL` — a build-time variable, so its
hostname is knowable. `next.config.ts` now derives a `remotePatterns` entry from
it, which is what unlocked the whole change.

| Component        | Surface                | `sizes`                                                    |
| ---------------- | ---------------------- | ---------------------------------------------------------- |
| `post-tile`      | community gallery grid | `(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw` |
| `project-card`   | projects grid          | same                                                       |
| `output-tile`    | studio results         | `(max-width: 640px) 50vw, 280px`                           |
| `project-detail` | project asset grid     | `(max-width: 640px) 50vw, 240px`                           |
| `post-view`      | public post hero       | `(max-width: 1024px) 100vw, 768px` + **`priority`**        |

**`sizes` is the whole point.** With `fill` and no `sizes`, the browser assumes
the image spans the viewport and picks the largest candidate — which would have
made the change worthless. The values above match the real grid, which is
`grid-cols-1 sm:grid-cols-2 xl:grid-cols-3`. I initially wrote them for a
four-column layout and corrected them after reading the actual markup.

`priority` appears exactly once, on the public post hero. It is the LCP element
of an indexable page — the one image a visitor came for. Everything else is in a
grid and should lazy-load.

`deviceSizes`/`imageSizes` were trimmed from Next's defaults: every extra width
is another variant to generate and store, and there is no 3840 px surface in
this product.

Also removed: UploadThing's `utfs.io` and `*.ufs.sh` from `remotePatterns`. They
were dead from Sprint 14 and survived because nothing pointed at that list.

## 2. Database — the daily-series aggregation moved into Postgres

The clearest algorithmic problem in the codebase. `dailySeries` ran three
unbounded `findMany` calls and bucketed the rows in a JavaScript loop:

```ts
prisma.generation.findMany({ where: { createdAt: { gte: since } }, … })
prisma.user.findMany({ … })
prisma.creditTransaction.findMany({ … })
// then: for (const row of generations) buckets.get(dayKey(row.createdAt))…
```

It produces at most 90 numbers. To get them it pulled **one row per generation,
per signup and per spend transaction** in the window across the wire. At a
million generations that is a million rows serialised, transferred and
garbage-collected to compute ninety integers — and the cost grows with the
product's success.

Now three `date_trunc` + `GROUP BY` queries returning ≤90 rows each. Prisma's
`groupBy` cannot group by an expression, so this is `$queryRaw` with `since` as
a bound parameter via the tagged template.

**Verified against real Postgres.** The rewritten SQL was run against PGlite
with three days of deliberately uneven fixture data and compared to the numbers
the loop produced:

```
PASS  gens      {2026-07-30:3, 2026-07-31:1, 2026-08-01:4}
PASS  signups   {2026-07-30:2, 2026-08-01:1}
PASS  spend     {2026-07-30:30, 2026-07-31:5, 2026-08-01:24}
date_trunc bucketing matches dayKey (UTC ISO slice): true
```

The UTC agreement matters: `dayKey` is `toISOString().slice(0,10)` and the
column is `timestamp` without a zone, so neither side converts.

## 3. Database — unbounded queries

**28 `findMany` calls: 17 bounded before, 21 after.** Counted by brace-matching
each call block, not by grepping files.

| Query                              | Bound  | Why that number                                                    |
| ---------------------------------- | ------ | ------------------------------------------------------------------ |
| `collectionAsset` in a project     | 500    | Rendered one tile each — an unbounded query _and_ an unbounded DOM |
| `follow` for the viewer's feed     | 2,000  | Built an `IN` clause from the whole following list                 |
| `collection` for the studio picker | 100    | A dropdown, ordered most-recently-touched                          |
| `folder` rail                      | 200    | Nobody navigates 500 folders from a sidebar                        |
| Monthly revenue transactions       | 10,000 | See the caveat below                                               |
| Two slug/name collision checks     | 500    | Only needs enough rows to pick a free suffix                       |

The seven that remain unbounded are bounded **by their caller**: five take
`id: { in: ids }` from an already-paginated page, and two are over the
first-party marketplace catalogue, which is code and has about thirty entries.
That is a real distinction, not an excuse — but it is also not verified by
anything, and a caller that stops paginating would reopen it.

**The revenue query is a compromise and I want it flagged.** The amount paid
lives in a `metadata` JSON column, not in a numeric column, so Postgres cannot
sum it without a JSON expression that must agree exactly with how the webhook
writes it. Getting that subtly wrong makes the revenue figure quietly incorrect,
which is worse than making it slow. So the rows are still summed in Node, with a
ceiling of 10,000. Past that the figure under-reports — and the dashboard
already labels it approximate and points at Stripe as the source of truth (§ 6).
The real fix is an `amountMinor` column, which is a schema change.

## 4. Rendering — `content-visibility` on the galleries

A new `card-defer` utility on the community, projects and marketplace grids:

```css
content-visibility: auto;
contain-intrinsic-size: auto 320px;
```

`contain-intrinsic-size` is the load-bearing half. Without it a skipped element
reports zero height, the scrollbar lurches as cards enter and leave, and every
lurch is cumulative layout shift — the utility would trade rendering work for
CLS. The value is the card's real rendered height.

**Verified live in a browser**: 4 `.card-defer` elements on `/projects-preview`,
3 on `/community-preview`, with `getComputedStyle().contentVisibility === "auto"`
on both.

## 5. Animation — a composited progress bar

`credits-card` animated `width` from 0 to a percentage over 0.9 s. Width is a
layout property: the browser lays out and paints the bar on every frame.
Changed to `scaleX` with `origin-left`, which is composited — GPU only, no
layout, no paint. Visually identical for a solid bar.

This was the only layout-animating property worth changing. The FAQ accordion
and the studio queue animate `height: auto`, which is genuinely hard to avoid
without measuring the content, and both are short and user-initiated. Left
alone and named here rather than changed riskily.

## 6. Code splitting — the settings tabs

`/settings` eagerly imported all five tab panels. Radix `Tabs` unmounts inactive
content, so three of them — including the delete-account flow and its
confirmation dialog — shipped to every visitor who came to change their display
name. Appearance, Notifications and Account are now `next/dynamic`.

**This did not move the number, and here is why.** `/settings` is 298 kB because
four of its five panels call Clerk's client hooks (`useUser`, `useClerk`), and
one of those is in the default tab. Clerk's client SDK dominates the route and
cannot be deferred behind a tab that is open on arrival. The split is still
correct — it defers three panels' own code — but the honest headline is that
`/settings` is a Clerk-weight problem, not a code-splitting one.

---

# What did not need changing

Reported because "we optimized it" would have been false.

**Fonts were already optimal.** `next/font/google` self-hosts Geist and Geist
Mono at build time, `display: swap`, `latin` subset only, with Next's automatic
fallback metrics for CLS. There is no runtime request to Google.

I nearly removed Geist Mono on the belief it was used only on a dev route and
one line of `error.tsx`. That was wrong: `font-mono` appears on ~20 real product
surfaces — prompt display, marketplace item details, billing, admin, post
prompts. Dropping it would have been a visible design regression sold as a
performance win.

**Icons were already optimal.** `optimizePackageImports` has covered
`lucide-react` and `motion` since Sprint 0, so the 84 icon import sites pull
only the icons used.

**Framer Motion is not in the shared chunk.** `MotionConfig` sits in the root
layout, which looked like it would put the motion runtime on every route. I
checked the built chunks for motion markers before acting: zero in all four
shared chunks. Next had already split it per-route. The shared 102 kB is React
and the Next framework, and it is irreducible without changing framework.

**The one scroll handler is already passive.** `site-header.tsx` registers
`{ passive: true }` and does nothing but compare `scrollY` to a constant.

---

# Measurements

## Bundle — measured, from `next build`

Full before/after in the table at the top. Summary: shared unchanged at 102 kB;
seven routes +5–6 kB from `next/image`; every other route unchanged.

## Runtime — partially measured

Against `next start` in a real browser:

| Metric                 | `/projects-preview`            | `/community-preview` |
| ---------------------- | ------------------------------ | -------------------- |
| TTFB                   | 13 ms                          | 8 ms                 |
| DOMContentLoaded       | 71 ms                          | —                    |
| Load complete          | 440 ms                         | 168 ms               |
| Transferred            | 385 kB                         | 27 kB                |
| DOM nodes              | 226                            | 137                  |
| Long tasks             | 0                              | —                    |
| `.card-defer` elements | 4 (`content-visibility: auto`) | 3 (same)             |

## What could not be measured

**Largest Contentful Paint and First Contentful Paint: not obtained.** The
`PerformanceObserver` calls returned no entries — the paint buffer had already
been flushed by the time script execution was available in this harness, on both
a fresh navigation and a client-side one. I am not going to report a number I
did not read.

**Cumulative Layout Shift: reported 0 with 0 shift events, and I do not trust
it.** A `layout-shift` observer with `buffered: true` returning zero entries is
consistent with "no shifts occurred" and equally consistent with "no entries
were available", which is exactly what happened to LCP on the same page. Treat
it as unmeasured.

**Interaction to Next Paint: not measured.** INP needs real interactions over a
session; there is no field data and no synthetic harness here.

**The image saving — the entire justification for the +6 kB — is unmeasured.**
No fixture sets a `coverKey` or a post asset URL, so `totalImgs` was 0 on both
preview routes and no `<Image>` has ever rendered in this codebase. There is no
`srcset` to inspect and no byte count to compare.

**The database work is unmeasured against a real database.** The aggregation SQL
is verified _correct_ against PGlite; it is not verified _faster_, because that
needs a Postgres instance with a realistic row count. The argument is
algorithmic — O(rows) transferred becomes O(days) — and algorithmic arguments
are strong, but they are not a measurement.

To get real Core Web Vitals this project needs: a database, seeded content,
fixtures with real image URLs, and Lighthouse or field data. That is Sprint 14's
"provision the infrastructure" item, and every performance number here is gated
behind it.

---

# Remaining bottlenecks

| #   | Issue                                                                                                                                                                                                                                                    | Severity |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | **No thumbnails.** `assets.thumbnailKey` exists in the schema and nothing populates it. `next/image` now resizes on demand, which moves the cost to our optimizer rather than removing it. A derivative generated once at write time is strictly better. | High     |
| 2   | **Client-driven job polling.** Unchanged. Every in-flight generation is an interval hitting the database from the browser. Needs the server-side worker named in Sprint 14.                                                                              | High     |
| 3   | **`contains` search is still a sequential scan.** Bounded to 120 characters by Sprint 15 and rate limited, but no `pg_trgm` or `tsvector` index exists.                                                                                                  | High     |
| 4   | **No video posters or range requests.** Video tiles still load whole files to show a first frame.                                                                                                                                                        | High     |
| 5   | **Trending has no supporting index.** Ranking by recent like volume will scan.                                                                                                                                                                           | Medium   |
| 6   | **`/settings` at 298 kB and `/profile` at 229 kB** are Clerk client-SDK weight. Reducing it means moving profile mutations to Server Actions — a real refactor, not a config change.                                                                     | Medium   |
| 7   | **`/design-system` at 268 kB** ships to production along with seven preview routes. Excluding the `(dev)` group from production builds removes them entirely; it is also security item #6.                                                               | Medium   |
| 8   | **Revenue still summed in Node** — see the caveat above. Needs an `amountMinor` column.                                                                                                                                                                  | Medium   |
| 9   | **No caching layer.** No Redis, no `unstable_cache`, no React `cache()`. The marketplace catalogue is static code and still re-derived per request.                                                                                                      | Medium   |
| 10  | **No performance budget in CI.** Nothing stops the next change adding 50 kB. There is no CI at all.                                                                                                                                                      | Medium   |
| 11  | **Project detail caps at 500 assets with no "load more".** A bound that renders beats an unbounded query that does not, but it is a ceiling, not pagination.                                                                                             | Low      |

---

# Verification

```
tsc --noEmit                 CLEAN
eslint . --max-warnings 0    CLEAN
prettier --check             CLEAN
next build                   SUCCESS (7.6s)
```

Aggregation SQL: 3/3 assertions pass against real Postgres.
`content-visibility`: confirmed computing on 7 elements across two routes.

---

## Honest summary

The two changes most likely to matter — responsive images and moving a
per-row aggregation into the database — are both real, both correct, and
**neither is measured**. One is unmeasurable here because no fixture has an
image; the other because there is no database with enough rows for the
difference to appear.

What is measured is that the bundle got slightly bigger, for a reason I can
argue but not yet prove. That is the accurate summary of this sprint, and it is
less satisfying than a table of improved numbers would have been.
