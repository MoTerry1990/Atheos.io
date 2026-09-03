# Incident — AudioGen published under a false licence

**Date raised:** 3 September 2026
**Severity:** High — non-commercial model output published on a commercial page
**Provider calls made during the response:** 0
**Spend during the response:** $0.00

---

## Summary

An internal model alias, `replicate/sfx`, described one model in the policy
registry and called a different one in the adapter. The described model was
permissively licensed. The called model was not.

The registry said:

| Field              | Recorded (wrong) |
| ------------------ | ---------------- |
| `hostedEndpoint`   | `zsxkib/mmaudio` |
| `auditedVersion`   | `62871fb5`       |
| `licence`          | `MIT (MMAudio)`  |
| `status`           | `ALLOWED_PUBLIC` |
| `commercialOutput` | `permitted`      |

`services/ai/providers/replicate.ts` has always pinned
`154b3e5141493cb1b8cec976d9aa90f2b691137e39ad906d2421b74c2a8c52b8`. That
version resolves to **`sepal/audiogen`** — Meta's AudioGen, from the AudioCraft
repository. Checked directly: HTTP 200 on `replicate.com/sepal/audiogen`, HTTP
404 on `replicate.com/zsxkib/mmaudio`.

AudioGen's weights are distributed under `LICENSE_weights` in the AudioCraft
repository: **Attribution-NonCommercial 4.0 International**. That is the same
file this registry already cites to block `replicate/music` (Score). CC-BY-NC
defines NonCommercial as "not primarily intended for or directed towards
commercial advantage or monetary compensation", which a paid product's
marketing page plainly is.

## Impact

1. **Published output.** The homepage showcase shipped an Audio tab playing
   `ambience.ae93b2317c.m4a`, and the Video tab's clip
   (`neural-core.ae93b2317c.mp4`) carried the same AudioGen-derived track muxed
   in. Both were live from commit `9e28f04` (2 September 2026) until the
   containment below.
2. **Offered for sale.** `replicate/sfx` was `ALLOWED_PUBLIC` and priced at 10
   credits, so it appeared in Studio discovery, in the connector catalogue, and
   in quotes.
3. **Public capability claims.** English and Spanish marketing copy advertised
   sound-effect and ambience generation, and the composer offered an Audio
   modality.

No customer generation of this model is known to have been billed; the alias
was reachable but the surface had only just shipped.

## Root cause

The registry was written as a description of intent rather than derived from
what the adapter calls, and nothing compared the two. A licence audit that
reads only the registry will confirm a false entry indefinitely — the entry
itself is the thing being checked.

The generic alias made this much harder to see. `replicate/sfx` reads as a
house sound-effects endpoint; nothing in the name suggests Meta's AudioGen, and
a reviewer checking "is SFX allowed?" is not prompted to ask "which model _is_
SFX?".

## Containment

All of the following landed together, with no provider call.

### Registry corrected

`services/ai/model-policy.ts` now records `replicate:sepal/audiogen`, version
`154b3e51`, `CC-BY-NC-4.0 (AudioGen weights, Meta AudioCraft)`, status
`BLOCKED_COMMERCIAL`, `permittedAudience: "nobody"`,
`permittedProvider: "none"`, `commercialOutput: "denied"`, with evidence URLs
for the model page, `LICENSE_weights`, and the AudioGen documentation.

Blocked for the owner as well as customers. An owner-evaluation carve-out
exists for models whose terms are merely _unconfirmed_; this one's terms are
confirmed and they say no.

### Generation path closed

Every gate derives from the registry, so correcting it closed all of them:

| Surface               | Mechanism                                                      |
| --------------------- | -------------------------------------------------------------- |
| Studio discovery      | `app/api/generations/route.ts` filters on `isPubliclyOffered`  |
| Marketing models page | `features/marketing/lib/public-models.ts` filters the same way |
| Connector catalogue   | `services/connectors/catalogue.ts` — absent for both audiences |
| Quotation             | `services/connectors/sequence-quote.ts` → `model_unavailable`  |
| Preparation           | `services/connectors/prepare.ts` → `model_unavailable`         |
| Confirmation          | `services/connectors/confirm.ts` re-resolves at spend time     |
| Pricing               | `services/billing/model-costs.ts` — `enabled: false`           |

**Previously issued quotes fail safely.** `confirm.ts` revalidates policy and
audience at spend time rather than trusting the signed quote — "the quote is a
price, never a permission". A quote issued before the correction now fails
`model_unavailable` at step 6, which is _before_ the credit reservation and
before provider submission. No credit is spent and nothing reaches Replicate.

### Public assets withdrawn

| File                                                         | Action  |
| ------------------------------------------------------------ | ------- |
| `public/marketing/showcase/ambience.ae93b2317c.m4a`          | deleted |
| `public/marketing/showcase/neural-core.ae93b2317c.mp4`       | deleted |
| `public/marketing/showcase/neural-core-1120.ae93b2317c.webp` | deleted |

The Audio showcase tab, the audio composer modality, the "Play with sound"
control, the mute toggle and the volume listener are all removed rather than
hidden. English and Spanish copy no longer claims any audio generation
capability, and the showcase section title is now "Two modalities. One
pipeline." / "Dos modalidades. Un solo flujo."

The replacement video, `core-silent.321dae2c42.mp4`, has **no audio stream at
all** — verified by scanning the container for the `mp4a` sample-entry box, not
by trusting the encoder flags. Its label is "AI-generated visual with cinematic
animation", which claims only what the file contains.

### Private material preserved

Deliberately **not** deleted, per the incident brief:

- `media-source/showcase/foley-ambience.wav` — the AudioGen master. Gitignored,
  never deployed, not reachable by any route.
- Database provenance rows and generation history.
- The private R2 master bucket.
- `scripts/build-showcase-media.mjs`, the script that muxed the track. Removed
  from the working tree so it cannot be re-run, and preserved in git history at
  commit `9e28f04`.

### Old deployments removed

Vercel keeps every production build reachable at its own immutable URL, so
deleting a file from `public/` does not withdraw the copies already published.
Twenty deployment URLs were checked directly. Two still served the prohibited
files with HTTP 200:

| Deployment         | Age at check | `ambience.…m4a` | `neural-core.…mp4` |
| ------------------ | ------------ | --------------- | ------------------ |
| `atheos-h4vma0qjo` | 14 h         | 200             | 200                |
| `atheos-9e9qird53` | 14 h         | 200             | 200                |

Both were deleted on the owner's instruction, and both now return 404. A
re-scan of every remaining deployment returns 404 for both files. Deleting
`atheos-h4vma0qjo` also removed the rollback target for commit `9e28f04`, which
was accepted as the cost of withdrawal: that build _is_ the one that served the
material.

The production domain is `atheos-io.vercel.app`. **`atheos.io` is not this
project** — it resolves to an unrelated third-party site (Liam Siira's "Atheos
Cloud IDE"), and any verification run against it proves nothing about Atheos.

## What prevents a repeat

`tests/unit/model-policy.test.ts` — "an alias cannot describe a model the
adapter does not call" — parses the pinned versions out of
`services/ai/providers/replicate.ts` and asserts that each policy entry's
`auditedVersion` is a prefix of the version the adapter actually pins. This is
the check that was missing. Mutation-verified: restoring `62871fb5` to the
registry fails with

> `replicate/sfx: policy audited "62871fb5" but the adapter pins "154b3e51…"`

`tests/unit/audiogen-containment.test.ts` asserts the rest of the surface —
policy fields, both audience gates, the cost table, the public models page,
publication eligibility, the absence of the showcase tab and provenance entry,
that no audio file of any extension exists anywhere under `public/`, and that
no showcase video contains an `mp4a` box.

## Open finding, outside this containment

`public/marketing/hero.c7da9646fe.mp4` carries an AAC stereo track at 48 kHz,
mean volume −15.0 dB, exposed to visitors through a "Hear audio" opt-in
control. It is **not** AudioGen — the master came from a Google model, evidenced
by the `encoder=Google` tag, the SynthID metadata and the C2PA manifest that
`docs/MEDIA-PROVENANCE.md` records as present in the source and destroyed by
the transcode.

**Its generating model is not recorded anywhere.** `MEDIA-PROVENANCE.md`
documents the master's hash, size and properties but never names the model that
produced it. Google's video models in this registry
(`replicate/veo-3.1`, `replicate/veo-3.1-fast`) are
`OWNER_EVALUATION_ONLY_PENDING_TERMS` and therefore not publishable.

This is raised, not fixed, because it is a different asset with a different
model and a different decision attached to it. It belongs to the full
publication audit.
