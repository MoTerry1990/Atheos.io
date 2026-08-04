# Performance Audit — Sprint 25

**Scope:** Phase 7. Images, fonts, bundles, dynamic imports, lazy loading,
Server Components, caching, API performance, database queries.
**Score: 62 / 100.**

**The headline has not changed since Sprint 16 and it is the most important
thing in this document: nothing here is measured.** Every optimisation below is
sound reasoning about mechanisms that are known to matter. None of it has been
observed against a deployed page with real data, because there has never been
one. An unmeasured performance posture is a hypothesis, and this report grades
it as such.

---

## Measured build output

The only real numbers available from this environment.

| Metric                      | Value       |
| --------------------------- | ----------- |
| Compile time                | **9.2 s**   |
| Pages generated             | **52**      |
| First Load JS shared by all | **102 kB**  |
| Middleware                  | **90.9 kB** |

**Heaviest routes by First Load JS**

| Route             | First Load JS | Note                                     |
| ----------------- | ------------- | ---------------------------------------- |
| `/studio-preview` | 305 kB        | 404s in production now — not a real cost |
| `/studio`         | 298 kB        | The product's core surface               |
| `/settings`       | 298 kB        | Dominated by Clerk's client SDK          |
| `/`               | 287 kB        | Statically prerendered                   |
| `/design-system`  | 268 kB        | 404s in production now                   |
| `/profile`        | 229 kB        | Clerk client SDK again                   |

102 kB shared is respectable for React 19 + Next 15. The three heaviest live
routes are all heavy for the **same reason**: Clerk's client SDK. That is one
problem, not three.

---

## What is genuinely optimised

**Fonts — ✅ correct, nothing to do.** Geist and Geist Mono via `next/font/google`,
self-hosted at build time. No runtime request to Google, no render-blocking
stylesheet, and no layout shift from a font swap — `next/font` reserves metrics.
This is the single highest-leverage font decision and it was made correctly in
Sprint 1.

**Images — ✅ configured well, ❌ never exercised.** AVIF and WebP, explicit
`deviceSizes`/`imageSizes` so the optimizer does not generate 20 variants,
`minimumCacheTTL` of one year, `remotePatterns` scoped to R2 and Clerk. Eight
files use `next/image`.

The honest part: **the application currently renders zero `<img>` elements** —
measured across all eight preview routes. Nothing has been generated, so no
`<Image>` has ever rendered. Sprint 16's replacement of five raw `<img>` tags
cost 5–6 kB of `next/image` runtime on seven routes for a benefit that is real
but **entirely unrealised**. The trade is sound — 6 kB against image bytes 10–100×
larger — and it is unmeasured.

**Server Components — ✅ used properly.** The default is server; `"use client"`
appears only where interaction requires it. `services/ai/catalogue.ts` is
`server-only`, so the landing page's provider section reads engine config at
build time and ships **zero JavaScript** for it.

**Caching — ✅ layered correctly.**

| Surface           | Policy                                         |
| ----------------- | ---------------------------------------------- |
| `/api/*`          | `no-store, no-cache, must-revalidate, private` |
| `/_next/static/*` | `public, max-age=31536000, immutable`          |
| `/dev/*`          | `public, max-age=86400`                        |
| `/sitemap.xml`    | ISR, 1 h revalidate / 1 y expire               |
| `/`               | Statically prerendered                         |

`no-store` on every API response is the right default for a product where nearly
every endpoint is user-scoped. A shared cache in front of a per-user response is
how one customer sees another's data.

**Database queries — ✅ the big win was taken.** Sprint 16 moved the admin daily
series out of a per-row JavaScript loop into `date_trunc` + `GROUP BY`, verified
identical against real Postgres. Producing thirty numbers should not transfer
thirty thousand rows. All usage aggregation is `GROUP BY` in Postgres and bounded
by a caller-supplied date range.

**Animation — ✅ composited only.** Transform and opacity throughout; the demo
progress bar animates `scaleX`, not `width`. `useInView` gates the landing
page's demo loop so a section three screens down does not run a timer.
`reducedMotion="user"` respected globally.

**Package imports — ✅** `optimizePackageImports` for `lucide-react` and `motion`,
the two barrel-export packages in the tree that would otherwise pull far more
than is used.

---

## What is not optimised

### 1. Core Web Vitals are unmeasured — **High**

LCP and FCP cannot be obtained from this harness. CLS reports zero and is
untrusted for the same reason. INP needs field data. Real numbers require a
deployed page with seeded content and real image URLs.

**This is the top performance action after deploy**, and it is cheap: run
Lighthouse against the deployed URL and record the three numbers. Everything
below is guesswork until then.

### 2. One dynamic import in the entire codebase — **Medium**

Exactly one `next/dynamic` across `app/`, `features/` and `components/`. The
obvious candidates on the 298 kB routes:

- The command palette (`cmdk`) — only needed on `⌘K`
- Motion-heavy studio panels below the fold
- The admin dashboard's charting

Each is a client island loaded eagerly today. This is the cheapest available
route-weight reduction and it is unmeasured, so it should be measured first.

### 3. `/studio` and `/settings` at 298 kB — **Medium**

Both are Clerk's client SDK. Reducing it means moving profile mutations to
server actions and dropping the client SDK from those routes — a real refactor,
and one worth costing only after Lighthouse says whether 298 kB is actually
hurting.

### 4. No thumbnails — **Medium**

`assets.thumbnailKey` exists in the schema and **nothing writes it**, so
galleries will serve full-size originals. On a grid of AI-generated images this
is the difference between a fast gallery and an unusable one, and it will be the
first thing real users notice. The column is there; the pipeline is not.

### 5. Sequential-scan search — **Medium**

`contains` search with no `pg_trgm` index. Fine at fixture scale, quadratic pain
at 100k rows.

### 6. 15 of 31 `findMany` calls unbounded — **Medium**

Most are bounded by an already-paginated caller. That is a real distinction and
nothing verifies it.

### 7. No caching layer — **Low for now**

No Redis, no `unstable_cache` on expensive reads. Correct to defer: caching
before measuring is how you cache the wrong thing.

### 8. Video delivery — **Low**

No poster images, no range-request handling for generated video.

---

## Vercel-specific notes

- **Compression is automatic** at the edge. Do not set `compress` in
  `next.config.ts` — it applies to the Node server Vercel does not use.
- **`regions: ["fra1"]`** is set in `vercel.json`. Pair the Supabase region with
  it. A cross-continent database adds 100 ms+ to **every** query and will
  dominate every other number in this document.
- **Cold starts** apply to all 36 API routes. Prisma's client init is the
  meaningful cost. `serverExternalPackages` already keeps it out of the bundle.
- **The image optimizer bills per source image.** With `minimumCacheTTL` at a
  year and explicit size lists, that cost is bounded — worth knowing before a
  gallery goes live.

---

## Recommended order after deployment

1. **Lighthouse against the deployed URL.** Record LCP, INP, CLS. Everything
   else is guesswork until this exists.
2. **Enable Vercel Speed Insights** for field data — synthetic Lighthouse and
   real INP frequently disagree.
3. **Build the thumbnail pipeline.** The column exists; this is the largest
   user-visible win and the only one that is certain without measuring.
4. **Then** dynamic-import the palette and studio panels, guided by (1).
5. Add `pg_trgm` when search is slow, not before.

The ordering is deliberate. Items 4 and 5 are the ones an engineer reaches for
first and the ones least justified without data.
