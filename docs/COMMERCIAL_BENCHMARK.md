# Commercial benchmark — authorisation request

Nothing here has been run. No paid call was made in this sprint.

## The measured gap

Both files probed with `ffprobe`, cuts detected with `ffmpeg -vf scdet` on
2026-08-23.

|            | Atheos baseline                        | Gemini reference                                       |
| ---------- | -------------------------------------- | ------------------------------------------------------ |
| File       | `atheos-m71o38-puh4t8.mp4`             | `now_create_a_viral_comercial_u.mp4`                   |
| Container  | 1920×1088, 24fps, 241 frames, 10.0417s | 1280×720, 24fps, 240 frames, 10.000s                   |
| Bitrate    | 24.7 Mbps (31 MB)                      | 2.0 Mbps (2.6 MB)                                      |
| Audio      | **none — no stream**                   | AAC stereo 48 kHz, 10.005s                             |
| Cuts       | **0** — peak scene score 2.28          | **3** at 2.167s / 4.917s / 7.417s (13.2 / 23.3 / 20.0) |
| Typography | none                                   | four timed titles, safe-area placed                    |
| Subject    | a 1960s roadster                       | the reference Porsche 911 Cabriolet                    |

The reference is a quarter of the pixels and eight per cent of the file size,
and it is the better commercial on every axis. **Resolution was never the gap.**

### Detector note

The first cut detector used `select='gt(scene,T)'` with `showinfo`. Run against
the reference — a file with three known cuts — it reported none, at every
threshold. `scdet` was validated against the reference before being trusted:

```
ffmpeg -v info -i INPUT -vf "scdet=threshold=0,metadata=print:file=-" -f null -
```

## What produced the baseline

Replicate prediction `54ekj5…fbv0`, 2026-08-23T01:03:49Z.

|               |                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Model         | `bytedance/seedance-1-lite` — **Motion Pro**, not Veo                                                                       |
| Metrics       | `predict_time` 72.5s, `resolution_target` 1080p, `video_output_duration_seconds` 10                                         |
| Input payload | **unavailable** — `data_removed: true`; Replicate purged the inputs per its retention policy                                |
| Adapter shape | `prompt`, `duration: 10`, `aspect_ratio: "16:9"`, `resolution: "1080p"`, `fps: 24` (+ `image` when a reference is attached) |

Seedance has no audio input or output of any kind, which is the complete
explanation for the silent file.

## Candidate costs

Rates read from the provider's own surfaces, not recalled.

| Candidate                       | Rate                               | 10s cost           | Native audio   | References                               |
| ------------------------------- | ---------------------------------- | ------------------ | -------------- | ---------------------------------------- |
| Motion Pro (`seedance-1-lite`)  | $0.054/s (invoice-derived)         | $0.54              | no             | image + last frame                       |
| Cinematic Fast (`veo-3.1-fast`) | **$0.15/s with audio** (Replicate) | 8s max → **$1.20** | yes            | first frame only                         |
| Cinematic (`veo-3.1`)           | **$0.40/s with audio** (Replicate) | 8s max → **$3.20** | yes            | **1–3 reference images**, 16:9 + 8s only |
| Veo 3.1 direct (Google)         | $0.12/s @1080p, $0.40/s standard   | —                  | yes            | as above                                 |
| Gemini Omni Flash               | ≈$0.10/s of 720p                   | —                  | not documented | documented, unverified                   |

Google's direct rate for Veo 3.1 Fast is $0.12/s at 1080p against Replicate's
$0.15/s — a 25% saving, and the only route to Omni Flash. It needs
`GOOGLE_AI_API_KEY`, which is absent from every environment.

## The proposed run — approval required

**Approval ID `BENCH-2026-08-23-A`.** One call, no retries, no second prediction
under this ID.

|                           |                                                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model                     | `google/veo-3.1` (Standard) — the only tier with `reference_images`                                                                                                     |
| Why Standard              | Subject identity is the largest gap, and multi-reference is the only mechanism that addresses it. Fast has a first frame only, which held the Porsche for ~3s last time |
| Duration                  | 8s (the maximum Veo renders; R2V requires exactly 8s and 16:9)                                                                                                          |
| Resolution                | 1080p, 16:9                                                                                                                                                             |
| Audio                     | native, on                                                                                                                                                              |
| References                | 1–3 stills of the approved red-car reference                                                                                                                            |
| Predictions               | **exactly 1**                                                                                                                                                           |
| **Maximum provider cost** | **$3.20**                                                                                                                                                               |
| Credits normally charged  | 1,920 (at the documented $0.005/credit and 3× video floor)                                                                                                              |
| Customer credits deducted | **none** — internal benchmark                                                                                                                                           |
| Expected latency          | ~2–4 minutes, unmeasured                                                                                                                                                |

### Passing criteria

1. `scdet` finds **3 cuts** in the 8-second file.
2. Audio stream present and not silent.
3. The car is recognisably the reference vehicle in all four shots.
4. Shot 3 is a true overhead — optical axis perpendicular to the road.
5. File measures 1920×1080 (or 1088, normalised in post) and ≈8.0s.
6. No model-rendered text anywhere.

Anything short of 1 or 2 is a **failed deliverable**, not a quality note.

## Cheaper alternative

The same run on Cinematic Fast is **$1.20** and tests only the edit instruction,
not subject identity — Fast has no reference input. Worth running first if the
question is "will Veo cut when told to cut in these words", and it is the
cheaper way to find that out.
