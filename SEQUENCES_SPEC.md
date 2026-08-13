# Sequences — long-form video, up to 2 minutes

**Status:** specified, not built.
**Scope decision:** cap at **2 minutes**. Not 5, 10 or 30 — see the ceiling
below.

---

## What this is

A **Sequence** is one user-facing video assembled from many generated clips.
The model produces 7.5 seconds at a time; a sequence turns N of those into a
single MP4 with one prompt flow, one credit charge and one result.

This is how every product that appears to make long AI video actually does it.
There is no model that generates two minutes in one call.

---

## The ceiling, and why 2 minutes

At 7.5s per clip and ~118s of render each:

| Target    |  Clips | Render (serial) | Compute @ $0.15–0.45 |
| --------- | -----: | --------------: | -------------------- |
| 30s       |      4 |          ~8 min | $0.60 – $1.80        |
| 1 min     |      8 |         ~16 min | $1.20 – $3.60        |
| **2 min** | **16** |     **~31 min** | **$2.40 – $7.20**    |
| 5 min     |     40 |         ~79 min | $6 – $18             |
| 30 min    |    240 |      **~8 hrs** | **$36 – $108**       |

Two limits bite before the technical one:

1. **Render time.** Even parallelised four-wide, two minutes of video is ~8
   minutes of waiting. Ten minutes of video is over half an hour.
2. **Coherence.** Independently generated clips drift — faces, lighting and
   style all wander. At 16 clips this is manageable with the mitigations below.
   At 240 it is a different video by the end, and no amount of engineering
   fixes it.

**2 minutes is where a stitched sequence still reads as one piece of work.**

---

## Architecture

### Data model — one new table

```prisma
model Sequence {
  id             String   @id @default(cuid())
  userId         String
  title          String?
  status         SequenceStatus   // DRAFT GENERATING STITCHING SUCCEEDED FAILED
  targetSeconds  Int
  seed           Int?             // shared across clips for consistency
  creditsCost    Int              // reserved up front, refunded on failure
  outputAssetId  String?          // the stitched MP4
  createdAt      DateTime @default(now())
  completedAt    DateTime?

  scenes         Scene[]
}

model Scene {
  id            String  @id @default(cuid())
  sequenceId    String
  index         Int              // order in the final cut
  prompt        String
  generationId  String?          // the clip, once generated
}
```

**Scenes reuse `Generation`.** A clip is an ordinary generation with everything
that already works — credits, retries, refunds, R2 storage, the worker. The
sequence is a container and an ordering, not a second pipeline.

### The stitch

`-c copy` concat. Every clip comes from the same model at the same resolution
and codec, so **no re-encode is needed** — the concat is a stream copy and takes
seconds rather than minutes. This is the single fact that makes the feature
cheap.

```
ffmpeg -f concat -safe 0 -i list.txt -c copy output.mp4
```

**Where it runs:** `ffmpeg-static` (~70 MB) inside a Vercel function with
`maxDuration: 300`. Verified as viable: no ready-made concat model exists on
Replicate — I checked four — so bringing our own binary is the option that adds
no new infrastructure.

Sixteen clips is ~32 MB down from R2 and ~32 MB back up. Comfortable inside 300
seconds; tight inside Hobby's 60. **This is a real reason to be on Pro.**

Fallback if the bundle proves too heavy: a small worker on Railway or Fly doing
nothing but stitching.

### Flow

```
1. User writes scenes (or one prompt → LLM expands to N scenes)
2. Reserve N x 90 credits in one transaction
3. Create Sequence + N Scenes
4. Worker generates clips — up to 4 concurrent
5. All succeeded → stitch → store in R2 → one Asset
6. Any clip fails permanently → refund the unused clips, keep what worked
```

Step 6 matters: a user who loses clip 14 of 16 should not lose the other 15
clips' worth of credits. Partial refund, and offer to regenerate the one scene.

---

## Coherence — the part that decides whether this is any good

Three mitigations, in order of impact:

1. **Shared seed** across all clips. Same seed, different prompt keeps the
   aesthetic anchored.
2. **Last-frame chaining.** Extract the final frame of clip N, pass it as the
   input image to clip N+1 via `image-to-video`. This is what Kling's "extend"
   does and it is the biggest single win.
3. **A style suffix** appended to every scene prompt — lighting, lens, grade —
   so the model is told the same thing about look each time.

Chaining makes clips serial rather than parallel, which trades render time for
quality. **Offer both:** "Fast" (parallel, cheaper, more drift) and "Coherent"
(chained, slower, holds together).

---

## Prompt enhancement — do this first, it is cheaper and worth more

Separate, smaller, and it improves **every** generation rather than only
sequences.

User types `a cat in space`. An LLM expands it into a proper prompt: subject,
lighting, lens, motion, grade, plus negative terms. Costs ~$0.001 per call.

For sequences the same call does more: one idea becomes N scene prompts with a
narrative arc.

**Build this before the stitching.** It is a day's work, it lifts output quality
across the whole product, and it is what makes "any idea they have" actually
produce something good.

---

## Credits and pricing

At 90 credits per clip:

| Length | Clips | Credits | At $0.015/cr |
| ------ | ----: | ------: | ------------ |
| 30s    |     4 |     360 | $5.40        |
| 1 min  |     8 |     720 | $10.80       |
| 2 min  |    16 |   1,440 | $21.60       |

**A 2-minute video costs more than the Creator tier contains.** That is either
a problem or the entire reason Studio exists — worth deciding deliberately.

If 90 credits per clip proves too steep once real costs are known, 60 makes a
2-minute sequence 960 credits and fits inside Creator.

---

## Build order

1. **Prompt enhancement** — 1 session. Independent, improves everything.
2. **Sequence schema + migration** — small.
3. **Sequence service** — reserve credits, fan out clips, partial refund.
4. **Stitching** — `ffmpeg-static`, the riskiest piece; prove it in isolation
   with two clips before wiring it in.
5. **Storyboard UI** — scene list, reorder, regenerate one scene.
6. **Plan gating** — sequence length by tier.

---

## Open questions

- **Vercel Pro?** 300s function duration and per-minute cron. Sequences need
  both. $20/month.
- **Fast vs Coherent** as a user choice, or always chain?
- Does a partially-failed sequence deliver the clips that worked, or nothing?
- Maximum concurrent clips per user — 16 at once from one account is real load.

---

## What this is not

Not 5, 10 or 30 minutes. Not one-call long-form. Not something any competitor
does either, whatever their marketing implies.

**Two minutes, coherent, reliable, at a price that makes money** is a better
product than thirty minutes of drifting footage that takes eight hours and
costs more than the plan it came from.
