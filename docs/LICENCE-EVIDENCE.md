# Licence evidence record

The audit trail behind `services/ai/model-policy.ts`. That file is the
authority the server enforces; this one records _why_ each status was chosen
and what would change it.

Statuses are defined in the policy module. In short:

| Status                                | Who may run it                     | Sold?  |
| ------------------------------------- | ---------------------------------- | ------ |
| `ALLOWED_PUBLIC`                      | anyone                             | yes    |
| `ALLOWED_PROVIDER_ENDPOINT_ONLY`      | anyone, on the named endpoint only | yes    |
| `OWNER_EVALUATION_ONLY_PENDING_TERMS` | the server-verified owner          | **no** |
| `BLOCKED_COMMERCIAL`                  | nobody                             | no     |
| `REVIEW_REQUIRED`                     | nobody, until reviewed             | no     |

---

## Two errors this record exists to prevent repeating

**Selling a non-commercial model.** Score ran MusicGen, whose weights are
CC-BY-NC-4.0, and was live at 20 credits. `NC` is an express prohibition on
exactly that. It is now `BLOCKED_COMMERCIAL`, with no owner carve-out: a
company evaluating its own paid feature is still commercial use.

**Reading silence as prohibition.** The first correction then took three
_proprietary hosted APIs_ offline because their endpoints publish no
open-source licence. They never would — they were never distributed as
weights. An absent SPDX badge on `google/veo-3.1` is not evidence that Google
forbid commercial use, any more than a provider's price list is evidence that
they permit resale. Both directions require actual evidence.

---

## Open item: written confirmation from Replicate

Three models sit at `OWNER_EVALUATION_ONLY_PENDING_TERMS` and will stay there
until the answer below is on file. **Not yet sent.**

> Does paid use of `bytedance/seedance-1-lite`, `google/veo-3.1-fast` and
> `google/veo-3.1` through Replicate permit us to offer end-user video
> generation inside a commercial SaaS product, charge users credits for
> generations, and allow users to use generated outputs commercially? Please
> identify every applicable third-party term, output restriction, attribution
> requirement, watermark requirement and territorial restriction.

**Addressee:** Replicate support / legal.

**When the answer arrives:** paste it verbatim below with the date and the
responder, then move the affected entries to `ALLOWED_PROVIDER_ENDPOINT_ONLY`
(not `ALLOWED_PUBLIC` — any grant obtained this way is a grant about
_Replicate's_ endpoints and must not travel to another host).

### Answer

_Not yet received._

---

## Why each status was chosen

### Motion 1 — `wan-video/wan-2.2-t2v-fast` → `ALLOWED_PUBLIC`

The endpoint publishes no licence, but the permission does not come from the
endpoint. Wan-AI release Wan 2.2 under Apache-2.0 and state they claim no
rights over generated content. PrunaAI, whose optimised build the endpoint
serves, state the base model's licensing terms remain applicable to the
adaptation.

This is the only video model where the grant follows the model rather than the
hosting arrangement, which is why it is public and the other three are not.

- <https://github.com/Wan-Video/Wan2.2>
- <https://huggingface.co/Wan-AI/Wan2.2-T2V-A14B>
- <https://replicate.com/wan-video/wan-2.2-t2v-fast>

### Motion Pro — `bytedance/seedance-1-lite` → owner evaluation

Replicate present the endpoint for commercial video production and grant
output rights _subject to third-party terms_ — and no third-party terms are
published for it. Genuinely ambiguous, and the ambiguity splits:

- evaluating a paid API to decide whether to build on it is ordinary
  diligence, and plainly what the endpoint is offered for;
- reselling generation access to customers for credits is a distribution
  right, which nothing on the record grants.

- <https://replicate.com/bytedance/seedance-1-lite>
- <https://replicate.com/terms>

### Cinematic / Cinematic Fast — `google/veo-3.1*` → owner evaluation

Same position. Proprietary hosted APIs offered for professional creation;
Google do not claim ownership of generated output. The reseller question is
what is unsettled.

**Watermark obligation, which is not contingent on any of that.** Veo output
carries SynthID and C2PA content credentials. They are how a viewer can tell a
clip is synthetic, and nothing in the pipeline may strip them.

Current state, verified 2026-08-25: `storeGeneratedAsset` writes provider bytes
verbatim to R2 (`PutObjectCommand` with the fetched buffer, no transcode), so
both survive storage and delivery.

The one component that re-encodes is the sequence soundtrack mux, which copies
the video stream and encodes only audio — so SynthID in the frames survives,
but a container-level C2PA manifest may not. Veo clips are owner-only and not
reachable by the sequence builder today; **if that changes, the manifest must
be carried across the remux before Veo is exposed publicly.**

- <https://replicate.com/google/veo-3.1-fast>
- <https://replicate.com/google/veo-3.1>
- <https://ai.google.dev/gemini-api/terms>
- <https://replicate.com/terms>

### FLUX.1 [dev] — endpoint-scoped

Commercial output use is granted through the Replicate endpoint; the
downloadable weights remain non-commercial. The status name carries the scope
because the scope is the whole point — self-hosting the same model is a
different question with a different answer.

- <https://replicate.com/black-forest-labs/flux-dev>

### Score — `meta/musicgen` → blocked

CC-BY-NC-4.0 weights. Blocked for every caller including the owner. Existing
history and stored assets are preserved untouched; the block is on running it,
not on remembering that it ran.

- <https://github.com/facebookresearch/audiocraft/blob/main/LICENSE_weights>
