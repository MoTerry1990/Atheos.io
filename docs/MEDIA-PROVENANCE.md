# Media provenance — marketing derivatives

Where a published marketing asset came from, what was done to it, and what that
did to its authentication.

## Why this file exists

`docs/LICENCE-EVIDENCE.md` records an obligation that SynthID watermarks and
C2PA content credentials "must survive storage and delivery intact". That rule
was written for **customer generations**, where `storeGeneratedAsset` writes
provider bytes verbatim and nothing re-encodes them. It holds there and is
proven by `tests/unit/output-preservation.test.ts`.

A marketing asset is a different case and the rule cannot hold in the same
form: a 44 MB master is unpublishable, and **any** re-encode invalidates a C2PA
manifest by design, because the manifest is cryptographically bound to the byte
stream it was signed over.

So the policy is split rather than quietly bent.

## The two categories

**Provider original.** Must be stored and deliverable intact. Never
transcoded, never overwritten, never replaced. This is every customer
generation, and it is also the master of any marketing derivative.

**Web marketing derivative.** May be transcoded, provided that:

1. the original remains intact and retrievable,
2. the derivative is linked to it by hash, both recorded here,
3. it is not presented as the original, and
4. no attempt is made to conceal that the content is AI-generated, or to strip
   a watermark in order to hide it.

The fourth point is the one that matters. Losing a C2PA manifest as an
unavoidable consequence of making a 6 MB file out of a 44 MB one is not the
same act as removing it to disguise the content's origin, and the page carries
an accessible "AI-generated video" label precisely so the disclosure survives
where the metadata could not.

## Hero — coastal drive

### Where the master lives

The canonical original is kept in a **second, private R2 bucket**, separate
from the public one that serves the site. The public bucket is fronted by a
CDN URL, so anything in it is reachable by anyone who learns the key — right
for a customer's finished asset, wrong for a 44 MB original that still carries
its content credentials.

The bucket is referred to here by its role rather than its name, and its
credentials live only in `R2_PRIVATE_*` server variables. Nothing about it is
`NEXT_PUBLIC_`, nothing signs a URL for it, and
`tests/unit/master-storage.test.ts` asserts all of that against the source.

The object key **is** the SHA-256 of the bytes:

```
masters/sha256/<sha256>.mp4
```

That makes the store idempotent and verification total — an object that hashes
to its own key cannot have been silently replaced. Verification downloads the
whole object through an authenticated client and hashes what arrives; the ETag
is deliberately not used, because it is an MD5 for a single-part upload and a
hash-of-hashes for a multipart one, and neither answers the question.

**Status: preserved and verified, 2 September 2026.** Uploaded by
`scripts/preserve-master.ts`, run under `vercel env run -e production` so the
credentials were never written to disk. What was checked, in order:

| Check                             | Result                                         |
| --------------------------------- | ---------------------------------------------- |
| Local size                        | 46,453,040 bytes — matches                     |
| Local SHA-256                     | `69d0211…6dfa48` — matches                     |
| Upload                            | written to `masters/sha256/69d0211…6dfa48.mp4` |
| Authenticated download            | 46,453,040 bytes read back                     |
| SHA-256 of the bytes that arrived | `69d0211…6dfa48` — matches                     |
| Anonymous request to the bucket   | HTTP 400, not served                           |
| Same key on the public CDN        | HTTP 404, not there                            |

A second run afterwards reported `already present` and verified again, which is
the content-addressed store behaving as intended: re-preserving a master is a
no-op, and verification is repeatable at any time without re-uploading.

|                    |                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Canonical source   | `media-source/hero-coastal-drive.master.mp4` (gitignored; the durable copy is in the private bucket) |
| Source SHA-256     | `69d021198d72596bd2319a37ca752cb84c223f36636327bf6cbbfff6a76dfa48`                                   |
| Source size        | 46,453,040 bytes (44.3 MB)                                                                           |
| Source properties  | 1920×1080, 8.000 s, 192 frames @ 24 fps, H.264 yuv420p, AAC stereo 48 kHz 256 kbps                   |
| Derivative created | 2026-09-02                                                                                           |

### Derivatives

| File                                                  | SHA-256                                                            | Derived from | Transformation                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/marketing/hero.c7da9646fe.mp4`                | `c7da9646fe81a164114aa48edab7fdaf8233da8d2da08928c439d01a3160d1ee` | source above | H.264 `preset slower crf 30`, `yuv420p`, `+faststart`, audio AAC 96 kbps stereo. No resize: 1920×1080 preserved. No trim: 8.000 s preserved. |
| `public/marketing/hero-poster.2fc1fb7043.webp`        | `2fc1fb7043f28fd63aa8473982429436c8601e9aa86eb1172a2d975950263fd0` | source above | Frame at 2.0 s, WebP q82, 1920×1080 native                                                                                                   |
| `public/marketing/hero-poster-mobile.40293fd880.webp` | `40293fd880e18f41e64cd3e8775f40ac07e02b40f812a1f973b10a3dff6f63da` | source above | Frame at 2.0 s, cover-cropped to 960×1200, WebP q82                                                                                          |

### What the transcode destroyed

Checked by scanning the derivative's container for each marker. **None of this
survived, and none of it is claimed to have survived:**

- **C2PA manifest** — the `jumb`/`c2pa` JUMBF box present in the source is
  absent from the derivative. **The derivative does not validate as C2PA
  content and must never be described as authenticated.** Restoring it would
  require re-signing the derivative under an Atheos C2PA identity, which does
  not exist.
- **SynthID metadata** — the `SynthID` string in the source container is gone.
- **`encoder` tag** — the source's `encoder=Google` tag is gone.

### What could not be verified

SynthID has two components: an imperceptible **in-pixel** watermark, designed
to survive re-encoding, and container metadata. The metadata is measurably
gone. Whether the pixel watermark survived **could not be verified here** —
that needs Google's detector, which Atheos does not have. This record therefore
claims neither that it survived nor that it did not.

### Why CRF 30 and not something gentler

Measured rather than assumed. SSIM against the master:

| Encode           | Size       | SSIM      |
| ---------------- | ---------- | --------- |
| H.264 CRF 24     | 18.4 MB    | 0.950     |
| H.264 CRF 27     | 11.1 MB    | 0.923     |
| **H.264 CRF 30** | **6.1 MB** | **0.888** |

A side-by-side crop at native resolution shows the car, the occupants, the
wheel spokes and the road are indistinguishable; the loss is confined to
high-frequency sparkle on the water and slight softening of foliage.

The obvious alternative — a shorter cut at higher quality — was tried and
**measured worse**: the strongest five seconds re-encoded at CRF 27 came to
7.6 MB, _heavier_ than the full eight seconds at CRF 30, because the segment
worth keeping is the most expensive to encode. Shortening does not help on
this material.

## Where the disclosure lives instead

Since the metadata could not carry it, the page does:

- an accessible label on the hero — "AI-generated video · Web-optimized preview",
- a "Content details" link to `/content-details`, which explains that the
  published file is a web-optimised derivative and that the authenticated
  original is preserved.

That page is the human-readable equivalent of the manifest the transcode
removed. It is not a substitute for C2PA and does not claim to be.
