# Video evaluation matrix

The one comparison that decides the default video model. **Nothing here has been
run.** Every row is a prediction from a schema read or a published price; the
point of writing it down first is that the benchmark can then confirm or refute
it rather than be interpreted afterwards.

Approval is required before any of it costs money. See _Approval request_ below.

## What the target actually is

From the user's own reference clip, measured with ffprobe rather than described:
1280×720, 24fps, 240 frames, 10.000s picture against 10.005s AAC stereo. The
target is not its resolution — Motion 1 already reaches 720p. It is:

- one coherent red convertible, one blonde driver, throughout
- coastal road beside vivid blue water, bright sky with detailed cloud
- several deliberate camera angles
- realistic vehicle motion, wheels turning with road speed
- native synchronised road, wind, ocean and engine sound
- a wait a consumer will tolerate

## Candidates

|                   | Motion 1           | Motion Pro chained   | Cinematic Fast       | Gemini Omni Flash           |
| ----------------- | ------------------ | -------------------- | -------------------- | --------------------------- |
| Model             | `wan-2.2-t2v-fast` | `seedance-1-lite` ×4 | `veo-3.1-fast`       | `gemini-omni-flash-preview` |
| Strategy          | continuous         | chained sequence     | directed sequence    | directed sequence           |
| Provider calls    | 1                  | 4                    | 1                    | 1                           |
| Length            | 5 / 7.5s           | 4 × 5s → 5s          | 4 / 6 / 8s           | not documented              |
| Resolution        | 720p               | 1080p                | 1080p                | 720p at the quoted rate     |
| Native audio      | no                 | no                   | **yes**              | not documented              |
| Reference images  | no                 | yes                  | no (full Veo has it) | documented for consistency  |
| Provider cost, 8s | n/a (7.5s max)     | $1.08 for 5s         | **$0.96**            | ≈$0.80 at 720p              |
| Wait              | ~5 min             | **~47 min**          | ~3 min (unmeasured)  | unknown                     |
| Reachable today   | yes                | yes                  | yes, flag off        | **no** — needs a Google key |

Costs: Motion 1 and Motion Pro are apportioned from a real Replicate invoice
(2026-08-13). Veo and Omni Flash are Google's published prices
(`ai.google.dev/gemini-api/docs/pricing`, 2026-08-22) — **Replicate's margin on
top is unverified and can only make them higher.**

## What the benchmark must record

Per candidate, using the **same red-car prompt and the same reference image**:

1. provider cost, from the invoice line rather than the estimate
2. wall-clock time, submit to delivered
3. how many of the four intended camera beats arrived
4. vehicle and driver consistency — same car, same person, start to end
5. colour and lighting consistency across the piece
6. motion realism, specifically wheel rotation against road speed
7. audio present, and whether it belongs to the picture
8. output resolution and duration, measured with ffprobe, not claimed

Items 3–6 are judged from extracted frames by a person. Items 1, 2, 7 and 8 are
measured.

## Approval request — no money spent until this is answered

|                          |                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Models                   | `google/veo-3.1-fast`, and `replicate/video-pro` for the chained comparison                                                                                               |
| Clips                    | 1 directed Veo generation, plus 4 chained Motion Pro calls                                                                                                                |
| Duration                 | 8s (Veo) · 4 × 5s (chained)                                                                                                                                               |
| Resolution               | 1080p both                                                                                                                                                                |
| Native audio             | Veo yes, chained no                                                                                                                                                       |
| **Max provider cost**    | **$2.10** ($0.96 + $1.08, before any Replicate margin)                                                                                                                    |
| Credits normally charged | 576 (Veo) · 720 (chained)                                                                                                                                                 |
| Passing criteria         | ≥3 of 4 beats recognisable; one car and one driver throughout; ocean on one side; wheels rotate; Veo returns a non-silent audio stream; file measures 1920×1080 and 8.00s |

Gemini Omni Flash cannot be included: it is not on Replicate and
`GOOGLE_AI_API_KEY` is unset. Including it needs a key and a direct adapter
first, which is a separate decision.
