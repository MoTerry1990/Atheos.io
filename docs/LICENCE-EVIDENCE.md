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

### Cinematic Next — `gemini-omni-1.1-flash` → owner evaluation

Google's own recommended default for video generation, reached **directly**
through the Gemini API rather than through a reseller. Verified against
official documentation on **2026-09-02**, after Google's 2026-08-27 update
resolved an ambiguity this record previously carried.

**The stable id is `gemini-omni-1.1-flash`.** The documentation now
distinguishes it from the preview alias `gemini-omni-flash-preview`, and only
the stable id may be integrated: an approval for a preview endpoint cannot
extend to whatever replaces it. An earlier note in
`services/ai/sequence-candidates.server.ts` asserted the preview alias as _the_
id and called the model unreachable; both statements were wrong and have been
corrected rather than left as a comment nobody re-read.

Documented capability, quoted rather than inferred: input text, image and video
(up to 10s for editing and extension); output video; **3–10 seconds** at 360p,
720p, 1080p or 4K; **24 FPS**. The SDK documents aspect ratios 16:9 and 9:16.

**Duration is not contractual, and Atheos must not pretend it is.** The
documentation describes 3–10 second outputs; it does not promise that a
requested length is honoured exactly, and timecodes inside a prompt steer a
model rather than binding it. `@google/genai`'s `VideoResponseFormat` does
carry an optional `duration`, which is worth recording precisely because it is
tempting — a field being present is not evidence that the output matches it.

So the capability is recorded as `durationMode: "model_decided"` over
`durationRange { min: 3, max: 10 }`, no enum of exact lengths is published,
`exactDuration` is not applied to this model, and the studio says **"Up to 10
seconds"**. The price is fixed at the 10-second maximum (policy A): quoting
happens before the length is known, and the alternative — reserve the maximum
and capture the measured cost — needs partial release in the ledger and
duration parsing from the MP4, neither of which is proven here.

**Only 720p is sellable.** Google publishes ~$0.10 per second specifically for
720p output. 1080p and 4K are documented outputs whose token consumption the
pricing read does not establish, so they are kept as internal capabilities
pending pricing and are not offered. Input tokens ($1.50/1M) are covered by a
documented buffer in the cost entry rather than ignored.

**Audio cannot be turned off.** The request schema documents no `generateAudio`,
`generate_audio` or equivalent, and the model "natively generates audio with
every video output". That is a capability statement, not a preference: Atheos
must not invent a parameter to satisfy a Silent control, and must not claim the
model can produce a silent clip. See `docs/AUDIO-POLICY.md`.

**Data use, which is the reason this is owner-only rather than public.** On the
paid tier Google states that prompts and responses are not used to improve its
products, and the Terms say the same for Paid Services accessed through a Cloud
project with billing enabled — with temporary retention for security, legal
compliance and abuse prevention. That is acceptable. What is not yet proven is
that _Atheos_ is on such a project: no `GOOGLE_AI_API_KEY` exists in any
environment, so the billing state cannot be demonstrated, and a free-tier key
would place customers' prompts under the free-tier policy. The adapter is
therefore built fail-closed and kept out of the live catalogue.

Four obligations that survive all of the above:

1. A Cloud project with **billing enabled**. Never the free tier for customer
   prompts.
2. The Terms state an API Client may not be **directed to, or likely to be used
   by, people under 18**.
3. The API may only be offered in **available regions**.
4. Google claims no ownership of generated output, and Atheos and its users
   remain responsible for lawful use.

SynthID and C2PA content credentials are enabled by default and must survive
storage untouched — the same obligation already recorded for Veo above, and
proven by the byte-identity test in `tests/unit/output-preservation.test.ts`.

- <https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash>
- <https://ai.google.dev/gemini-api/docs/pricing>
- <https://ai.google.dev/gemini-api/terms>
- <https://ai.google.dev/gemini-api/docs/available-regions>
- <https://cloud.google.com/blog/products/ai-machine-learning/nano-banana-2-lite-and-gemini-omni-flash-available>

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

## Audit: the three models that published without approval — 3 September 2026

Triggered by the containment hotfix in commit `28107ef`, which withdrew 25
public gallery cards. Sources read directly from the provider's live model
pages on the audit date.

### What the evidence says

All three are Replicate **Official** models — published and maintained by the
model owner rather than a community mirror — and all three carry Replicate's
`Commercial use` badge. The badge's own tooltip text, verbatim:

> Outputs from this model can be sold or used in paid products.

`google/nano-banana-pro` additionally carries `Data privacy` ("Inputs and
outputs are not retained") and `Zero training` ("Inputs and outputs are not
used for training"). `bytedance/seedance-1-lite` carries `Zero training`.
Neither page states a licence name, and neither states an attribution
requirement.

| Model                       | Atheos id                   | Owner                          | Badges                                                |
| --------------------------- | --------------------------- | ------------------------------ | ----------------------------------------------------- |
| `google/nano-banana-pro`    | `replicate/nano-banana-pro` | Google DeepMind (Gemini 3 Pro) | Official, Commercial use, Data privacy, Zero training |
| `google/nano-banana-2`      | `replicate/nano-banana-2`   | Google                         | Official, Commercial use                              |
| `bytedance/seedance-1-lite` | `replicate/video-pro`       | ByteDance                      | Official, Commercial use, Zero training               |

Sources, read 3 September 2026:

- <https://replicate.com/google/nano-banana-pro>
- <https://replicate.com/bytedance/seedance-1-lite>

### Verdict: no policy entry added

The bar for an entry is that authoritative evidence **conclusively** establishes
commercial output permission _and_ public marketing permission. Only the first
is established.

"Sold or used in paid products" is a statement about commerce in the output.
The Atheos home page is not a paid product: it is free, public advertising for
one. Using a generation as marketing on a free page is adjacent to that
permission and is not the same sentence, and the rule here is that approval is
never inferred. Neither page links the model owner's own terms, so what Google
or ByteDance require of the Replicate route could not be read at all.

So all three remain absent from `services/ai/model-policy.ts`, the fail-closed
rule continues to apply, and the 25 withdrawn cards stay withdrawn.

### The same question applies to a model already in use

`replicate/flux-dev` is `ALLOWED_PROVIDER_ENDPOINT_ONLY` on exactly this
reasoning — non-commercial weights, commercial output granted through the
hosted endpoint — and it currently supplies the showcase Image tab. If
"commercial output" is not read as covering public marketing, that entry needs
the same scrutiny and the Image tab needs a different source. Flagged rather
than resolved here, because it is a change to an existing approval and not
mine to make silently.
