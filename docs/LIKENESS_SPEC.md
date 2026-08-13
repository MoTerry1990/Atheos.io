# Personal Likeness — specification

**Status:** proposed, not built. Nothing in this document ships until the
consent flow in §5 exists and a lawyer has reviewed §7.

A user records their own face, voice and — optionally — their body, and can
then generate video of themselves without filming. This is the highest-risk
feature in Atheos by a wide margin, and the risk is not technical.

---

## 1. Naming

**Not** "likeness", "digital twin", "avatar" or anything with `flow`, `gem` or
`veo` in it. Those either describe a competitor's product or read as a clone of
one.

Proposed: **Presence**. A user creates _a Presence_; a generation _uses your
Presence_. It is an ordinary English noun, it is not a Google or an OpenAI
product name, and it says what the thing is.

Before committing: run a trademark search on "Presence" in class 9 and class 42.
The word is generic enough that it is likely unregistrable as a standalone mark
in this class — which is fine, since it is a feature name and not the brand, but
it also means somebody else may already be using it descriptively. That is a
lawyer question, not a design question.

---

## 2. What it is, precisely

Three separately-consented captures, each independently deletable:

| Capture   | Required | What it produces                         | Roughly                      |
| --------- | -------- | ---------------------------------------- | ---------------------------- |
| **Face**  | yes      | An identity embedding + reference frames | 20–40s of video              |
| **Voice** | no       | A voice model                            | 60–120s of clean read speech |
| **Body**  | no       | Full-body reference frames               | 15–30s, three angles         |

Face alone is enough to generate. Voice adds speech. Body allows full-figure
shots instead of head-and-shoulders.

**Body is opt-in and stays opt-in.** The user's instinct here is right: a
meaningful number of people will want their face used and their body not, and
the interface must never make body capture feel like a step they are skipping
rather than a choice they are declining. No progress bar that reads "2 of 3
complete". Three independent cards, each with its own state.

---

## 3. The rule that governs everything

> **A Presence may only be created from the person operating the account,
> present at the time of capture.**

Not "a person who has consented". Not "a person whose release you hold". The
person at the keyboard, live, now. Every other rule in this document is
downstream of that one.

This is stricter than the law requires in most jurisdictions and it is
deliberate. The alternative — accepting third-party consent — means Atheos is
adjudicating whether an uploaded release form is genuine, at scale, for people
it cannot contact. That is not a business we can operate.

Consequences:

- **No file upload.** Capture is live camera and microphone only. An upload
  path is an impersonation path, and it is the _only_ path an impersonator has.
- **Liveness check during capture.** Randomised prompts — turn left, turn
  right, blink, say a displayed four-word phrase. A prompt sequence generated
  server-side per session and validated against the recording. This defeats
  playing a video of somebody else at the camera, which is otherwise trivial.
- **One Presence per account, replaceable.** Not a library. An account that can
  hold five faces is an account being used to impersonate four people.
- **Face-match on regeneration.** Replacing a Presence must match the previous
  one above a threshold, or the account is flagged for review. An account whose
  face changes entirely is either a shared login or a sold one.

---

## 4. Data model

```prisma
enum PresenceStatus {
  DRAFT          // capture started, consent not yet given
  PENDING_REVIEW // liveness passed, awaiting automated + sampled human check
  ACTIVE
  SUSPENDED      // flagged; generation blocked, data retained pending outcome
  DELETED        // tombstone: see the retention note below
}

enum CaptureKind { FACE VOICE BODY }

model Presence {
  id     String @id @default(cuid())
  userId String @unique
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  status PresenceStatus @default(DRAFT)

  /// Every capture that makes up this Presence.
  captures PresenceCapture[]

  /// Every consent event, append-only. Never updated, never deleted —
  /// withdrawal is a new row, not a mutation. The question "what exactly did
  /// this person agree to, and when" must be answerable years later, and it
  /// cannot be if the record is overwritten each time the terms change.
  consents PresenceConsent[]

  createdAt DateTime  @default(now())
  deletedAt DateTime?
}

model PresenceCapture {
  id         String      @id @default(cuid())
  presenceId String
  presence   Presence    @relation(fields: [presenceId], references: [id], onDelete: Cascade)
  kind       CaptureKind

  /// R2 key. Never a public URL — these objects are served only through a
  /// short-lived signed URL issued to the owning user.
  storageKey String
  /// SHA-256 of the stored object, so tampering is detectable.
  checksum   String

  /// The server-issued liveness prompt sequence, and whether it was satisfied.
  livenessChallenge Json
  livenessPassed    Boolean @default(false)

  createdAt DateTime @default(now())
  deletedAt DateTime?

  @@unique([presenceId, kind])
}

model PresenceConsent {
  id         String   @id @default(cuid())
  presenceId String
  presence   Presence @relation(fields: [presenceId], references: [id], onDelete: Cascade)

  /// Which document, at which version. A consent that does not name the
  /// version of the text it agreed to is not evidence of anything.
  documentId String
  version    String
  /// Hash of the exact text shown on screen at the moment of agreement.
  textHash   String

  kind      CaptureKind?
  granted   Boolean
  /// Collected because biometric statutes generally require proof of
  /// *informed, written* consent, and these are what make it provable.
  ipAddress String?
  userAgent String?

  createdAt DateTime @default(now())
}
```

**Retention.** Deletion means the R2 objects and the derived models are
destroyed within 30 days, and the `PresenceCapture` rows go with them. The
`PresenceConsent` rows survive as a tombstone, because the record that somebody
consented and later withdrew is the thing that protects both sides — and it
contains no biometric data. This asymmetry must be stated plainly in the
consent text; a privacy policy that says "we delete everything" while retaining
consent logs is inaccurate, and inaccuracy here is the whole exposure.

---

## 5. The consent flow

Consent is collected **three times**, separately, immediately before each
capture — never once up front for all three. A single checkbox covering face,
voice and body is exactly the pattern regulators treat as invalid.

Each step:

1. **Plain-language explanation.** What is captured, what is derived from it,
   where it is stored, who can access it, how long it is kept, how to delete it.
   Written at the reading level of somebody who is not a lawyer, because that is
   who is reading it.
2. **The scope, stated as limits rather than permissions.** "Atheos may generate
   video and audio of you, at your request, from your account. Atheos will not
   use your face or voice to train models, will not show them to other users,
   will not license them to anyone, and will not use them in marketing."
3. **An explicit affirmation**, typed rather than checked: the user types
   `I AGREE` (or `ACEPTO`). A checkbox is a click; typing is a decision. This
   also produces a cleaner record.
4. **Record**: document id, version, hash of the displayed text, timestamp, IP,
   user agent.

Withdrawal must be **as easy as granting** — one screen, no email, no support
ticket, effective immediately for new generations. That is a legal requirement
under GDPR Art. 7(3) and it is also just correct.

### What the user sees before any of this

A screen that says, without softening it:

> This creates a video and audio likeness of **you**. Do not use it for anyone
> else — not a friend, not a family member, not a public figure. Recording
> happens live and includes checks that you are the person on camera.
>
> You can delete your Presence at any time, and everything derived from it is
> destroyed within 30 days.

---

## 6. Abuse prevention

| Risk                                  | Control                                                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Impersonating a third party           | Live capture only, randomised liveness prompts, one Presence per account                                                                                         |
| Account sold or shared after creation | Face-match on replacement; periodic re-verification for high-volume accounts                                                                                     |
| Non-consensual intimate imagery       | Prompt-level blocklist and output classifier on every Presence generation, **not sampled** — this is the failure that ends the company                           |
| Public-figure likeness                | Face matched against a public-figure index at creation; a hit routes to human review, not an automatic block, because false positives on ordinary faces are real |
| Minors                                | Age estimation at capture; below threshold routes to human review and the Presence stays `PENDING_REVIEW`. Terms already require 18+                             |
| Political or electoral misuse         | Generations using a Presence are watermarked and carry C2PA content credentials, always, with no opt-out                                                         |

**Watermarking is not optional and not a setting.** Every Presence generation
carries a visible mark and embedded C2PA provenance. A user who wants
unmarked video of their own face is asking for the exact artefact that makes
this feature dangerous, and "but it is my own face" does not distinguish them
from someone who has stolen an account.

---

## 7. Legal — needs a lawyer, not me

I can build the mechanism. I cannot tell you it is compliant, and you should
not launch on my assessment. Specific things to take to counsel:

- **Biometric statutes.** Illinois BIPA is the sharp one: private right of
  action, statutory damages per violation, and it has produced nine-figure
  settlements. Texas CUBI and Washington HB 1493 are similar in substance.
  BIPA requires written consent _and_ a published retention schedule _and_
  destruction within a defined period. A US launch without BIPA-specific review
  is the single largest legal risk in this product.
- **Peru.** Ley 29733 (Protección de Datos Personales) treats biometric data as
  sensitive and requires prior, express, informed consent. Since Atheos is
  operated from Peru, this applies to you directly regardless of where users
  are.
- **GDPR Art. 9** — biometric data for unique identification is a special
  category; explicit consent is the only realistic lawful basis, and it must be
  separable and withdrawable.
- **Right of publicity**, state by state in the US, and the newer synthetic
  media statutes (Tennessee ELVIS Act, California AB 602/1831).
- **The EU AI Act** deep-fake transparency obligations, which is the reason
  the C2PA requirement above is non-negotiable.
- **Your terms and privacy policy** both need new sections. The current ones do
  not contemplate biometric processing at all.

Two things worth saying plainly:

1. The consent text in §5 is a **draft for a lawyer to rewrite**, not a
   finished document. It is written to be honest and readable, which is the
   right starting point, but it has no legal review behind it.
2. Doing this well is what prevents the lawsuit. The exposure is not from users
   creating a Presence of themselves — it is from one account creating a
   Presence of somebody else and the resulting video reaching that person. Every
   control in §6 exists for that scenario.

---

## 8. Providers

Nothing here can be built with the current Replicate models. Options:

| Need                      | Candidates                                                     | Note                                                                                                                     |
| ------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Voice cloning             | ElevenLabs Professional Voice Clone                            | Has its own consent flow and verification, which is a point in its favour — it means two parties independently gate this |
| Face-consistent video     | Runway Act-Two, Hedra, Replicate character models              | Quality varies enormously; needs a bake-off                                                                              |
| Face embedding / matching | InsightFace via Replicate                                      | For the match-on-replacement check                                                                                       |
| Liveness                  | Custom — server-issued prompts validated against the recording | Off-the-shelf KYC liveness is available but expensive per check                                                          |

**Provider terms matter as much as capability.** Any provider that trains on
submitted data is disqualified, without exception, and this has to be verified
in the contract rather than the marketing page.

---

## 9. Pricing

Presence creation: **free**, one-time. Charging for it pushes users toward
creating one before they have decided, which is the opposite of informed
consent.

Generation using a Presence: the normal video cost **plus a premium**, because
the underlying models are more expensive and slower. Roughly 250–400 credits
for a five-second clip, pending the provider bake-off.

Availability: **Creator and above.** Not because Free users deserve less, but
because an account that costs nothing to create is the one an impersonator
uses, and a card on file is a meaningful deterrent and a forensic trail.

---

## 10. Build order

1. Consent documents, versioned, with the hash-on-display mechanism — first,
   because everything else records against it
2. Schema and migration
3. Capture UI: camera, microphone, liveness prompts, per-capture consent
4. Storage: R2 with server-side encryption, signed URLs only, no public bucket
5. Liveness validation and face matching
6. Provider integration behind the existing adapter contract
7. Watermarking and C2PA on the output path
8. Deletion: user-facing, with the 30-day destruction job
9. Abuse controls and the review queue
10. Legal review — **before** any of it is enabled in production

Steps 1–5 are a sprint on their own. Nothing user-visible should ship until
step 10 is complete.
