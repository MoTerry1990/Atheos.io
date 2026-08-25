# Delivery measurement — specification

**Status: built.** The container half shipped on 2026-08-24; decoded loudness
and silence validation shipped the same day. What remains unbuilt is listed
under "Still not measured" below.

## Decoder decision, proved rather than assumed

FFmpeg was rejected on evidence. There is no separate execution environment —
the "worker" is a Vercel cron calling a serverless route, so everything runs in
the same Node lambda. A native binary would mean an 80 MB download from a
third-party release at every build plus an entry in this project's deliberate
`allowScripts` allowlist.

`audio-decode` is 400 KB of WASM. Measured **in the deployed Vercel lambda**
before adoption, decoding the real 7.3 MB benchmark:

|            |                          |
| ---------- | ------------------------ |
| Runtime    | linux x64, Node v24.18.1 |
| R2 fetch   | 602 ms                   |
| **Decode** | **187 ms**               |
| Peak RSS   | 149 MB                   |

Identical measurements locally and deployed.

## Calibration

`integratedLufs` is ITU-R BS.1770-4 — K-weighting, 400 ms blocks at 75%
overlap, absolute gate at -70 LUFS, relative gate 10 LU below the ungated mean.
Not RMS under a different name, which would compare real audio against
published LUFS thresholds it does not measure.

Validated against a reference signal:

| Signal               | Measured        | Expected               |
| -------------------- | --------------- | ---------------------- |
| 1 kHz sine, -20 dBFS | **-19.99 LUFS** | ≈ -20                  |
| its peak             | -20.00 dBFS     | -20.00                 |
| its RMS              | -23.01 dBFS     | -23.01 (peak - 3.01)   |
| digital silence      | undefined       | no measurable loudness |

The owner-approved benchmark measures **-20.9 LUFS**, peak -5.70 dBFS, 0
clipped samples, 0.2% silence — and now passes cleanly rather than carrying a
warning that loudness could not be measured.

## Still not measured

- **True peak (dBTP).** Sample peak is measured; inter-sample peaks need
  oversampling.
- **Semantic content.** The gate validates _signal_, not meaning. It cannot
  recognise a saxophone, detect dialogue, or judge whether the sound matches the
  brief. No verdict may be described as confirming intended audio.
- **Containers other than MP4 and MOV.** These return `best_effort` with an
  explicit "not validated" warning, never a silent pass.

Written 2026-08-24, after Step 4 of the Truth & Audio sprint was found to be
unverifiable.

---

## 0. What now exists, and what does not

`services/video/container-probe.ts` parses the MP4 box tree in pure TypeScript —
no ffmpeg, no native dependency, no binary to spawn — and reports whether a
`soun` track exists along with its codec, channel count, sample rate and
duration. `services/video/delivery-audio-check.ts` feeds that into
`runAudioGate` and is called from `settleSuccess` **before** the asset
transaction, so a model that promised sound and returned a silent file fails and
refunds rather than being delivered.

That closes the gap this document was written about: the gate is no longer
called by tests alone.

**It does not close the whole question.** A container probe reads the file's
index; it decodes nothing. It can prove a track is _absent_ and it cannot prove
that a track which exists carries anything but silence. The distinction is
explicit in the type — `MeasuredAudio.scope` is `"container"` here — and at that
scope a missing loudness reading is recorded as a warning rather than a failure,
because failing on it would refuse every generation for not doing work this
stage never claimed to do.

### Still specification, and still needed

Everything below that requires a **decoder**:

| Measurement                | Why a probe cannot give it                       |
| -------------------------- | ------------------------------------------------ |
| Integrated loudness (LUFS) | Requires decoding samples and an EBU R128 filter |
| True peak (dBTP)           | Requires oversampled sample values               |
| Longest digital silence    | Requires reading the waveform                    |

These matter for the failure a container check cannot see: a file with a valid
AAC track that is **eight seconds of silence**. That is still deliverable today,
and it is why the worker phase below is not optional. At `full` scope the gate
already treats an unmeasurable loudness as a failure — the code is written and
waiting for something to produce the number.

### One free signal in the meantime: encoded data rate

The container indexes every frame's byte length in `stsz`, so summing it and
dividing by the track duration costs one pass over a table already in memory and
no decoder at all.

Measured on the Veo 3.1 Fast benchmark render of 2026-08-24:

|               |                |
| ------------- | -------------- |
| Frames        | 377            |
| Mean frame    | 683 bytes      |
| Duration      | 8.033 s        |
| **Data rate** | **256.5 kbps** |

AAC encoding pure digital silence collapses to near-minimum frames, one to two
orders of magnitude below that. The gate warns below **8 kbps**, which sits in
the gap with margin on both sides.

**It warns; it does not fail.** The threshold rests on a single measured example
and no measured silent baseline — and a check built on one data point is exactly
how this gate failed a good Veo render and refunded it (see
`tests/unit/real-mp4-offsets.test.ts`). It earns a failure once the worker has
real loudness to calibrate against.

It is also not a proof of audibility even then: a track can carry a healthy
bitrate of room tone nobody can hear. Only loudness settles that.

---

## 1. The problem

`services/video/audio-gate.ts` decides whether delivered audio is acceptable. It
is a **pure function**: it takes an already-measured object and returns a
verdict. It does not open a file.

```ts
interface MeasuredAudio {
  hasStream: boolean;
  codec?: string;
  sampleRate?: number;
  channels?: number;
  durationSeconds?: number;
  integratedLufs?: number;
  truePeakDb?: number;
  longestSilenceSeconds?: number;
}
```

**Nothing produces that object at runtime.** `audio-gate.ts` is imported by
exactly one file — `tests/unit/video-audio.test.ts` — which constructs the
measurements by hand. `services/video/delivery-gate.ts` says of itself: _"Pure —
it builds arguments, it does not run ffmpeg."_

So the audio delivery guarantee is **true of the tested function and not of the
running product**. A promised-audio generation that comes back silent is
delivered and settled today, because nothing looks.

The same gap covers container metadata. `assets.width`, `assets.height` and
`assets.durationMs` are nullable and, in the two generations audited on
2026-08-23, **all three were NULL**. Nothing measures a delivered file at all.

### Why it cannot simply be added to the existing path

`ffprobe` is a native binary. Vercel's serverless runtime has none, and the
generation pipeline runs there. This needs somewhere else to execute.

---

## 2. Where ffprobe runs — options

Costs are for the current volume (single-digit generations/day) and at 1,000
generations/month for comparison.

| #   | Option                                                | Cost                                 | Cold start | Verdict                                                                                                                     |
| --- | ----------------------------------------------------- | ------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| A   | Bundle a static `ffprobe` in the Vercel function      | $0 extra                             | +2–4 s     | **No.** ~45 MB against a 250 MB unzipped limit, and it inflates every function in the deployment, not just this one.        |
| B   | Small always-on container (Fly.io / Railway / Render) | ~$5–7/mo flat                        | none       | **Recommended for now.** Full ffmpeg, no per-call arithmetic, one thing to operate.                                         |
| C   | AWS Lambda + ffmpeg layer                             | ~$0.00005/probe → **$0.05/1,000**    | 1–2 s      | **Cheapest at scale.** Adds an AWS account, IAM and a second deploy target.                                                 |
| D   | Cloudflare Workers + `ffmpeg.wasm`                    | ~$0                                  | slow       | **No.** WASM decode of a 10 s 1080p clip is minutes and memory-bound; loudness needs a full decode.                         |
| E   | Hosted media API (Mux / Transloadit / Cloudinary)     | ~$0.001–0.01/asset → **$1–10/1,000** | none       | Viable, but it is a third vendor holding customer media, and the whole point of `services/` is not to be surprised by one.  |
| F   | A Replicate model that runs ffprobe                   | ~$0.0002+/call, plus queue latency   | 5–30 s     | **No.** Paying a GPU provider to run a CPU tool, and it puts measurement behind the same queue whose output it is checking. |

**Recommendation: B now, C if volume justifies it.** B is one container, one
secret, and no per-invocation reasoning; at single-digit daily volume the flat
$5 is cheaper than the time spent modelling C's cost.

### R2 egress is free, and that matters

Cloudflare R2 charges **$0 for egress**. The worker downloading every delivered
file to probe it is therefore free in bandwidth, which removes the usual
argument for probing in-region. Storage-class and Class-B operation costs still
apply and are negligible at this volume.

### Two probes, not one

They have very different costs and should not be conflated:

| Probe                            | Needs                                | Data read             | Time           |
| -------------------------------- | ------------------------------------ | --------------------- | -------------- |
| Container + stream presence      | `ffprobe -show_streams -show_format` | **byte range**, ~1 MB | <1 s           |
| Loudness (`ebur128`) and silence | full decode                          | **whole file**        | ~0.3× realtime |

`hasStream`, `codec`, `sampleRate`, `channels`, `durationSeconds`,
`width`/`height` come from the cheap probe. `integratedLufs`, `truePeakDb` and
`longestSilenceSeconds` require the expensive one.

**Consequence:** a generation that promised _silence_ only needs the cheap
probe. Only a promised-audio generation needs the full decode. That is most of
the cost avoided for free.

---

## 3. How results reach `audio-gate.ts`

The pipeline already has the right seam. `app/api/worker/tick/route.ts` is a
secret-protected POST that polls providers and advances jobs; measurement
belongs between _"the provider says succeeded"_ and _"settle the credits"_.

```
provider succeeded
      │
      ▼
  store asset in R2                        (exists today)
      │
      ▼
  enqueue MeasurementJob(assetId)          NEW
      │
      ▼
  worker: signed GET from R2 → ffprobe     NEW  (container, § 2B)
      │
      ▼
  POST /api/internal/measurement           NEW  (WORKER_TRIGGER_SECRET)
      │
      ├── write assets.width/height/durationMs   (columns exist, unused)
      ├── judgeAudio(measured, promised)  ← audio-gate.ts, unchanged
      │
      ▼
  pass → settle & deliver   |   fail → release reservation, mark failed
```

### Design constraints

1. **Settlement waits for measurement.** Today the asset is stored and the
   credits captured in the same pass. That order has to change or the gate is
   advisory: a verdict that arrives after the money has moved is a report, not a
   gate. The generation sits in a `MEASURING` state until the worker answers.
2. **The worker never decides.** It produces a `MeasuredAudio` and posts it.
   `audio-gate.ts` stays the only place a verdict is formed, so the rule lives
   in one testable pure function — which is why it was written that way.
3. **Unmeasurable fails closed.** If the worker cannot probe the file — timeout,
   corrupt container, worker down — the verdict is _fail_, not _pass_. Commit
   `e6caffc` already established this for loudness; it must hold for the whole
   path. A gate that passes when it cannot see is worse than no gate, because it
   is believed.
4. **Bounded retries, no paid regeneration.** Measurement may retry (it is
   cheap and idempotent). A measurement failure must **never** trigger a second
   provider call — the expensive artefact already exists.
5. **No signed URL leaves the worker.** It receives an asset id and mints its
   own short-lived R2 URL server-side, exactly as `resolveAnimationSource` does.

### New surface

| Thing                            | Where                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `MeasurementJob` queue           | `Generation.status = MEASURING` + a nullable `measuredAt`; **needs a migration** |
| `POST /api/internal/measurement` | new route, `WORKER_TRIGGER_SECRET`                                               |
| `services/video/measure.ts`      | wraps the worker call, returns `MeasuredAudio`                                   |
| worker container                 | new repo or `workers/` dir; ffmpeg + a 100-line HTTP handler                     |

**Migration required.** Adding a `MEASURING` status is an enum change. Per
standing policy this stops for approval before it is applied.

---

## 4. What "audio verified" means, per model

Derived from `AUDIO_CAPABILITIES`. The promise is what the user confirmed; the
measurement is what came back. The gate compares them — it never infers the
promise from the file.

| Model                              | Strategies                      | Promise              | "Verified" means                                                                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Motion 1** `video-gen`           | `ATHEOS_SOUND_DESIGN`, `SILENT` | Silent               | Cheap probe only. **No audio stream.** A stream here means the wrong file was delivered.                                                                                                                                                            |
|                                    |                                 | Atheos sound design  | Full probe **after** the mux. AAC, 48 kHz, stereo, duration within tolerance of the video, ≈−16 LUFS, true peak ≤ −1 dBTP, not near-silent. The model itself is silent — the track is Atheos's and is labelled as such.                             |
| **Motion Pro** `video-pro`         | `ATHEOS_SOUND_DESIGN`, `SILENT` | as above             | as above                                                                                                                                                                                                                                            |
| **Cinematic Fast** `veo-3.1-fast`  | `NATIVE`, `SILENT`              | Native               | Full probe. Stream present, AAC, 48 kHz, duration matches, **not near-silent** (the failure mode that matters: Veo returning a technically-valid but empty track). No unrequested speech.                                                           |
|                                    |                                 | Silent               | Cheap probe. `generate_audio: false` was sent; **no stream** expected.                                                                                                                                                                              |
| **Cinematic** `veo-3.1`            | `NATIVE`, `SILENT`              | as above             | as above                                                                                                                                                                                                                                            |
| **Cinematic Lite** `veo-3.1-lite`  | `NATIVE` only, `audioAlwaysOn`  | Native, **always**   | Full probe. **A silent result is a failure even if the user asked for silence** — the model cannot turn audio off, so a missing stream means the file is not what the model produces. This is the one tier where "silent" is never a valid outcome. |
| **Score** `music`, **Foley** `sfx` | native (audio models)           | Audio is the product | Full probe. Stream present, correct duration, not silent. No video stream expected.                                                                                                                                                                 |

### Thresholds

Reuse what `audio-gate.ts` already encodes rather than restating them here —
that file is the single definition and this table is its index. The numbers
quoted above (48 kHz, ≈−16 LUFS, ≤−1 dBTP) are the current values and will
follow it if it changes.

### What is deliberately _not_ checked

- **Whether the audio is any good.** Loudness and silence are measurable;
  "does the fire sound like fire" is not, and pretending otherwise would put a
  subjective judgement behind an objective-looking gate.
- **Speech detection.** "No unrequested dialogue" is in the brief but needs
  transcription to enforce. Until that exists it is a prompt instruction, not a
  guarantee, and should not be described as one.

---

## 5. Sequencing

1. Worker container + cheap probe → populate `assets.width/height/durationMs`.
   No gate, no settlement change. Immediately useful and reversible.
2. Full probe + `judgeAudio` wired, **advisory**: log the verdict, do not block.
   Establishes a real-world false-positive rate before it can refuse a delivery.
3. Migration for `MEASURING`, settlement moved behind the verdict. Gate becomes
   binding.
4. Only then is a Veo benchmark worth its $1.20 — it would be testing the gate
   rather than testing ffprobe.
