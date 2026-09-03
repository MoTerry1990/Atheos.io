# Native audio and storyboard capability audit

**Sprint 5D — 2026-08-16.** Audit only: no generation was run, no provider was
added, no migration was written.

Every capability claim below was read from a provider's OpenAPI input schema via
`GET /v1/models/{owner}/{name}/versions/{id}`, not from vendor documentation or
a landing page. Where a claim could not be verified, it is marked unverified
rather than assumed.

---

## 1. The finding

**Atheos cannot generate video with sound, and could not have at any point.**

This is not a wiring gap. Both shipped video models' schemas were read in full,
and neither has an audio input of any kind:

| Model      | Slug                         | Audio input? |
| ---------- | ---------------------------- | ------------ |
| Motion 1   | `wan-video/wan-2.2-t2v-fast` | **None**     |
| Motion Pro | `bytedance/seedance-1-lite`  | **None**     |

`grep -ri "nativeaudio\|native_audio\|withAudio\|audioMode"` across the
repository returned nothing before this sprint. The concept did not exist in the
product, which is at least consistent: nothing in the UI promised sound.

The brief asks that _"for every video model that supports native audio, 'Include
audio' must default to ON."_ Applied to the current catalogue, that rule governs
**zero models**. Implementing the control today would produce a toggle that is
disabled everywhere it appears.

### What Atheos _can_ do with sound today

**Nothing, as of 3 September 2026.** This section described two working audio
models. Both are Meta AudioCraft weights under CC-BY-NC 4.0 and both are now
`BLOCKED_COMMERCIAL`:

- `replicate/music` (meta/musicgen, `stereo-large`) — blocked
- `replicate/sfx` (sepal/audiogen) — blocked, and it had been recorded as
  `zsxkib/mmaudio` under MIT until the alias was checked against the adapter.
  See [`INCIDENT-2026-09-03-AUDIOGEN.md`](INCIDENT-2026-09-03-AUDIOGEN.md).

The mechanism below is real and still works. What it has no longer got is a
model it is allowed to run. Read the rest as a design record rather than as a
description of a shipped capability.

`features/sequences/components/soundtrack-panel.tsx` generates one and
`muxAudio` in `features/sequences/lib/stitch.ts` lays it under an assembled
sequence in the browser, as a video stream copy. This is real and useful. It is
**not** native audio: it is a second, separately billed generation, and it is
not synchronised to anything on screen. The contract in
`services/ai/audio-intent.ts` names it `post_process` precisely so the UI can
never present it as the same thing.

---

## 2. Verified capability matrix

Read 2026-08-16. Shipped models first.

### `wan-video/wan-2.2-t2v-fast` — Motion 1

Inputs: `prompt`, `seed`, `num_frames` (default 81), `frames_per_second`
(default 16), `resolution` (`480p` | `720p`), `aspect_ratio` (`16:9` | `9:16`),
`go_fast`, `interpolate_output`, `sample_shift`, `optimize_prompt`,
`disable_safety_checker`, four `lora_*` fields.

- Audio: **no**
- Image input: **no** — text-to-video only
- Negative prompt: **no**
- Duration: frames ÷ fps; the catalogue offers 5 s (81 frames) and 7.5 s (121)

### `bytedance/seedance-1-lite` — Motion Pro

Inputs: `prompt`, `image`, `last_frame_image`, `reference_images`, `duration`
(default 5), `resolution` (`480p` | `720p` | `1080p`), `aspect_ratio` (7 values),
`fps` (fixed 24), `camera_fixed`, `seed`.

- Audio: **no**
- First frame / last frame: **yes** — `image` and `last_frame_image`
- Reference images: **yes** (appearance steering, not an identity lock)
- Negative prompt: **no** (the catalogue already recorded this correctly)
- Camera control: a single `camera_fixed` boolean

### Not shipped — evaluated for audio

| Model                      | Audio                                | Durations | Resolutions | Notes                                    |
| -------------------------- | ------------------------------------ | --------- | ----------- | ---------------------------------------- |
| `google/veo-3`             | **`generate_audio`, default `true`** | 4, 6, 8   | 720p, 1080p | Takes `image`, `negative_prompt`, `seed` |
| `google/veo-3-fast`        | **`generate_audio`, default `true`** | 4, 6, 8   | 720p, 1080p | Identical input shape                    |
| `kwaivgi/kling-v2.1`       | none                                 | 5, 10     | —           | `start_image`, `end_image`               |
| `minimax/hailuo-02`        | none                                 | 6 default | —           | `first_frame_image`, `last_frame_image`  |
| `bytedance/seedance-1-pro` | none                                 | 5 default | —           | `camera_fixed`                           |

**Veo 3 and Veo 3 Fast are the only models found with a native audio input**, and
their `generate_audio` already defaults to `true` — the same default the product
rule asks for.

### Capabilities no verified model has

- **Multi-shot in one job.** Every model returns one continuous shot.
- **Character/identity lock.** `reference_images` steers appearance; it does not
  guarantee the same face across shots, and describing it as consistency would
  be exactly the overclaim this audit exists to prevent.
- **Video extension / continuation.**
- **Reference video input.**
- **Per-channel audio direction.** Veo 3 offers one boolean. There is no
  dialogue channel, no effects channel, no music bus.

---

## 3. Two defects found while reading the schemas

### 3.1 Motion 1 advertised two inputs it does not have — **fixed**

`services/ai/providers/replicate.ts` declared `supportsImageInput: true`,
`supportsNegativePrompt: true` and listed `image-to-video` among Motion 1's
operations. The schema has none of the three.

This was not cosmetic. `buildInput` sends `image` whenever a reference is
attached and `negative_prompt` whenever the flag permits it, so a user who used
either would have had their job rejected by the provider **after** 90 credits
were reserved — recoverable through the Sprint 5C.1 settlement path, but a
wasted wait for a failure that was knowable from a static table.

Corrected in this sprint: Motion 1 is now text-to-video only, with no negative
prompt. Image-to-video remains available on Motion Pro, whose schema genuinely
supports it.

### 3.2 The registry's pinned versions no longer resolve to distinct schemas

Requesting Motion 1's pinned version `c483b1f7…` returned schema `2454a6ebc0f1`;
Motion Pro's pinned `6e47dd83…` returned `e356125bf592`. Replicate appears to
alias official-model versions to the current publication. The practical effect
is that **version pinning is not currently guaranteeing input stability**, and a
vendor schema change would reach production without a deploy. Not fixed here —
it needs a decision about whether to pin, to validate inputs against a fetched
schema at submit time, or to accept the drift. Raised for a later sprint.

---

## 4. The contract shipped in this sprint

Two new files, both pure, both free of database and network access, so the same
code answers in the composer and on the server.

### `services/ai/video-capabilities.ts`

One typed record per model, each carrying `slug`, `verifiedAt` and `notes` so any
claim traces back to the schema it came from. Cost is deliberately **not**
duplicated here — `services/billing/model-costs.ts` owns price and the spending
breaker reads that one. They join on `id`.

### `services/ai/audio-intent.ts`

```
native_full_mix | native_sfx_ambient | native_dialogue | silent | post_process
```

`validateAudioIntent(modelId, requested)` is called **before credits are
reserved**. The alternative — reserve, submit, receive a silent file, settle a
refund — costs the user a wait and Atheos a provider bill to reach a "no" that a
static table already knew.

Rejections carry a stable code, never a rendered sentence, so the UI owns the
wording including its Spanish wording:

| Code                    | Meaning                        | The user's next step                         |
| ----------------------- | ------------------------------ | -------------------------------------------- |
| `model_has_no_audio`    | Schema has no audio input      | Switch model, or add a soundtrack afterwards |
| `channel_not_separable` | Has audio, but one mixed track | Switch mode, not model                       |
| `invalid_mode`          | Not a mode at all              | Client bug or forged request                 |
| `unknown_model`         | No capability record           | Catalogue gap                                |

`silent` and `post_process` are offered by every model: any model can decline to
make sound, and any video can have a separately generated track laid under it.
Native modes appear only where the schema has an audio input.

`generateAudio` is set only for native modes — `post_process` must not set the
provider flag, or the user is billed for audio twice.

**No migration.** `Generation.parameters` is already `Json?`, so the resolved
mode persists under `audioMode`. `readStoredAudioMode` returns `silent` for every
row written before this contract existed, which is accurate: they were all
silent.

### Tests

`tests/unit/audio-capabilities.test.ts` — 27 tests, split deliberately:

- **Contract tests** pin behaviour that must hold whatever the catalogue
  contains: audio defaults ON wherever it is possible, refusals precede money,
  every advertised mode is accepted, no rejection is a dead end.
- **Fact tests** pin what the providers offered on 2026-08-16. If Replicate ships
  audio on Wan tomorrow, those failures are the correct way to find out —
  because the marketing copy has to change in the same commit.

---

## 5. Storyboard and multi-shot: what is possible

`Sequence` and `Scene` already exist in `prisma/schema.prisma`. A scene is an
ordinary `Generation`, so it inherits credits, retries, refunds, R2 and the
worker. The container is real; what is missing is continuity.

Since **no model supports multi-shot or a character lock**, cross-shot
consistency has to be constructed:

1. **Shared seed.** `Sequence.seed` already exists and is applied to every clip.
   The strongest single lever, and free.
2. **Frame chaining.** Motion Pro's `image` + `last_frame_image` allow shot N's
   final frame to open shot N+1. This is the only genuine continuity mechanism in
   the catalogue. It would need the last frame extracted after each clip — the
   browser ffmpeg in `stitch.ts` can already do this without server compute.
3. **Reference images.** Motion Pro's `reference_images` steers appearance
   across shots. Helpful; not a guarantee.
4. **Style-locked prompt prefix.** Shared lighting/lens/palette text on every
   scene prompt.

None of these is native cross-shot consistency, and the UI must not imply that
it is. The honest framing is "consistency aids", with the tradeoff stated.

**Not implemented here.** Frame chaining changes how scenes are submitted and
adds a per-scene extracted-frame asset, which is a schema question. Proposed
below rather than built, per the brief.

---

## 6. Proposals requiring approval

Each is a substantial provider change or a migration, and is therefore proposed,
not implemented.

### 6.1 Add Veo 3 — the only route to native audio

The single change that would make "Include audio, default ON" mean anything.

Blocking issue: **the price is unverified.** Replicate publishes no per-second
rate through the API, and Veo 3 is materially more expensive than wan-2.2. The
entry in the capability table is therefore `available: false`, and
`model-costs.ts` refuses an unpriced model by design — Rule 1 there is that an
unknown cost cannot be offered for money.

Sequence, if approved: one metered run at the user's expense → read the real
invoice line → add a verified `ModelCostEntry` at the 3.0× video margin → wire
the adapter's `generate_audio` → enable. The capability record and the validator
already handle it; only cost and adapter are missing.

### 6.2 Frame chaining for sequences

Needs somewhere to store each scene's extracted final frame, and a submission
order that is serial rather than parallel (shot N+1 cannot start until shot N
finishes). The serial ordering is the larger change: it converts a sequence from
a fan-out into a chain, multiplying wall-clock by the number of scenes.

### 6.3 Persisting audio intent on `Sequence`

Currently expressible per generation through `parameters`. A sequence-level
default would want a column. Deferred — `parameters` covers the need without a
migration.

---

## 7. What is proved, and what is not

**Proved.** Both shipped models' complete input schemas, read from the provider.
The absence of any audio input on either. Veo 3's `generate_audio` and its
default. The two false capability flags on Motion 1, now corrected. The
validator's behaviour, under 27 tests.

**Not proved.** Veo 3's real cost per second — unmeasured, and the reason it
stays off. Output _quality_ of Veo 3's audio: no generation was run. Whether
frame chaining actually produces acceptable continuity on seedance-1-lite: not
tested, because testing it means paid generations. Whether version pinning
protects against vendor schema drift — the evidence in §3.2 suggests it does not.

**Not verified and therefore not claimed anywhere in the product.** Native audio.
Multi-shot generation. Character consistency. Video extension.
