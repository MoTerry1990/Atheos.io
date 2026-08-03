# AI Studio Redesign — Sprint 22

**Goal:** redesign the studio into a premium creative workspace.
**Constraint honoured:** no new APIs connected. UX only.

**Status:** four new capabilities built and verified in a browser, one real
accessibility bug fixed. **The twelve-panel list was not rebuilt from scratch** —
nine of those panels already existed and were already good. What was missing was
the _workspace_ around them, and that is what this sprint built.

---

## What I actually changed, and what I did not

The brief lists twelve panels. Reading the studio before touching it, nine
already existed:

| Requested         | Status before this sprint     |
| ----------------- | ----------------------------- |
| Prompt Editor     | ✅ `prompt-editor.tsx`        |
| AI Model Selector | ✅ `model-picker.tsx`         |
| Style Presets     | ✅ `style-and-camera.tsx`     |
| Reference Images  | ✅ `reference-upload.tsx`     |
| Camera Controls   | ✅ `style-and-camera.tsx`     |
| History Panel     | ✅ `queue-and-history.tsx`    |
| Generation Queue  | ✅ `queue-and-history.tsx`    |
| Preview Window    | ✅ `preview-panel.tsx`        |
| Download Center   | ✅ `output-actions.tsx`       |
| **Left Sidebar**  | ❌ — built                    |
| **Asset Library** | ❌ — **not built**, see below |
| **Timeline**      | ❌ — **not built**, see below |

Rewriting nine working panels to satisfy a checklist would have been churn with
a regression attached. **Rebuilding what already works is not a redesign, it is
a rewrite with extra risk.** So this sprint built the four things the workspace
genuinely lacked and fixed a real defect, and is explicit about the two panels
it did not build.

---

## Built

### 1. Modality rail — the left sidebar

`features/studio/components/modality-rail.tsx`

Four modalities: Image, Video, **Audio**, **Text**.

**Audio and text do not work, and the rail says so.** `services/ai/engine.ts`
rejects both with `unsupported_operation` because no adapter implements either.
Both are shown **disabled with a specific reason**, plus a banner in the
composer if a user lands there.

The two alternatives are worse:

- _Hide them._ The product's own marketing claims three modalities and two voice
  packs sit in the marketplace. Hiding audio makes the product inconsistent with
  itself and gives the user no way to find out where it went.
- _Show them working._ A user picks Audio, writes a prompt, presses generate and
  gets an error. That is a worse minute than reading "not available yet".

The selection indicator is a Framer Motion `layoutId`, so the pill **moves
between** buttons rather than cross-fading. That is the difference between a
selection that travels and one that blinks, and it is one prop rather than a
hand-written transition.

### 2. Command palette — `⌘K`

`features/studio/components/command-palette.tsx`, on `cmdk`.

`cmdk` was removed in Sprint 14 as an unused dependency. It now has a use, so it
is back — which is the correct outcome of that removal, not a reversal of it.

**Every command shows its keyboard chord.** A user who reaches for the palette
twice learns the key the third time and stops needing it. A palette that does
not teach its own shortcuts trains people to keep using the palette.

**The command list is generated from the shortcut registry**, not a second
array. A palette that drifts from the keys it advertises is worse than no
palette, and one source is the only reliable way to prevent that.

### 3. Keyboard shortcuts — one registry

`features/studio/lib/shortcuts.ts`

| Chord       | Action                      |
| ----------- | --------------------------- |
| `⌘K`        | Command palette             |
| `⌘↵`        | Generate                    |
| `/`         | Focus the prompt            |
| `1` `2` `3` | Compose / Preview / Results |
| `⇧?`        | Shortcut reference          |
| `Esc`       | Close overlays              |

**The default is that shortcuts do not fire while typing**, and that default is
the whole design. A bare `g` bound to "generate" fires on every `g` typed into a
prompt — the single most common way a shortcut system becomes something users
switch off. Only modifier chords opt in, because a modifier is a deliberate act
ordinary typing cannot produce.

`⌘↵` is the one exception that must work mid-prompt: a user finishes writing and
submits without leaving the field.

The registry feeds both the palette and the `⇧?` reference sheet, so neither can
describe a key that does not work.

### 4. Resizable panels

`features/studio/components/resizable.tsx`

Hand-rolled rather than a dependency. The libraries solve a harder problem than
we have — nested groups, collapsible panels, conditional layouts — and the
studio has two dividers in a fixed three-column layout.

What the libraries get right and hand-rolled versions usually do not is done
properly here:

- **Keyboard operable.** A real `role="separator"` with `aria-valuenow`,
  focusable, moved with arrows, `Home`/`End` to the bounds, `⇧` for coarse
  steps. A divider draggable only by pointer is unusable to anyone on a
  keyboard, and this one controls how much screen the prompt gets.
- **Pointer capture**, not window listeners — a fast drag cannot detach, and
  nothing leaks if the component unmounts mid-drag.
- **12px hit area around a 1px line.** A 1px target fails WCAG 2.5.8 and is
  miserable regardless.
- **Widths persist**, written on release rather than per frame — a write per
  pointer move is thousands of synchronous serialisations during one drag.
- **Double-click resets** to the midpoint, the conventional escape hatch when a
  panel has been dragged somewhere unusable.

Verified live:

```
role="separator" aria-orientation="vertical" aria-label="Composer width"
aria-valuenow="26" aria-valuemin="18" aria-valuemax="40" tabindex="0"
```

---

## Bug fixed

**`/studio-preview` skipped a heading level: `h1 → h3`.**

Found by Sprint 17's E2E suite and left failing then, deliberately, as a real
finding. Radix's `Accordion.Header` renders an `h3`, so the composer's sections
landed directly under the page `h1`.

The fix is a real section heading, not a downgraded accordion: the composer _is_
a section of the workspace, and giving it the `h2` it always implied makes the
outline read `h1 → h2 → h3` without touching a shared primitive four other pages
depend on.

**Also fixed while building:** `ModalityRail` used Radix `Tooltip` without a
`TooltipProvider`, which failed the production build during prerender of
`/studio-preview`. The rail now carries its own provider — a component that
needs a context should supply it, because relying on a distant ancestor makes
the component unusable anywhere else, which is exactly what a preview route is
for.

---

## Requirements: honest status

| Requirement         | Status                                                  |
| ------------------- | ------------------------------------------------------- |
| Left Sidebar        | ✅ Modality rail                                        |
| Prompt Editor       | ✅ Existed                                              |
| **Asset Library**   | ❌ **Not built**                                        |
| AI Model Selector   | ✅ Existed                                              |
| Style Presets       | ✅ Existed                                              |
| Reference Images    | ✅ Existed                                              |
| Camera Controls     | ✅ Existed                                              |
| **Timeline**        | ❌ **Not built**                                        |
| History Panel       | ✅ Existed                                              |
| Generation Queue    | ✅ Existed                                              |
| Preview Window      | ✅ Existed                                              |
| Download Center     | ✅ Existed as output actions                            |
| Image / Video       | ✅ Real                                                 |
| Audio / Text        | ⚠️ Present, disabled, reason given                      |
| Framer Motion       | ✅ Palette, sheet, rail indicator                       |
| Keyboard shortcuts  | ✅ 8, in one registry                                   |
| **Autosave drafts** | ⚠️ **Params autosave; named drafts do not exist**       |
| Resizable panels    | ✅ With keyboard support and persistence                |
| Command Palette     | ✅ `⌘K`                                                 |
| Light / dark mode   | ✅ Already worked; every new component uses tokens only |

### The three that are not what the brief asked for

**Asset Library — not built.** This is the cross-project asset browser the audit
has listed as missing since Sprint 8. It is a genuine feature with a service
layer, pagination and deletion semantics — not a studio panel. Building a
half-version inside the studio would create a second place assets are listed,
which is how two views start disagreeing.

**Timeline — not built.** A timeline implies multi-clip video editing:
sequencing, trimming, transitions. Atheos generates single clips and has no
concept of a composition. A timeline UI over one clip would be a control with
nothing to control.

**Autosave drafts — partial.** Composer parameters already persist via the
Zustand store's `partialize` (references stripped). What does _not_ exist is
**named, multiple drafts** — a list you can title, switch between and restore.
That needs storage and a data model decision, and I did not want to invent one
in a UX-only sprint.

---

## Verification

```
tsc --noEmit                 CLEAN
eslint . --max-warnings 0    CLEAN
prettier --check             CLEAN
next build                   SUCCESS
vitest                       255 passing (17 files) — no regressions
```

Live against `next start`:

| Check                             | Result                                       |
| --------------------------------- | -------------------------------------------- |
| Modality rail renders             | ✅ `aria-label="Output type"`                |
| Resize separator with full ARIA   | ✅ valuenow / valuemin / valuemax / tabindex |
| Unavailable-modality copy present | ✅                                           |
| Prompt shortcut target present    | ✅ `data-studio-prompt`                      |
| Heading structure                 | ✅ `h1 → h2 → h3`, skip resolved             |

**Not verified:** the interactions themselves. Opening the palette, dragging a
divider, and firing a shortcut are pointer and keyboard behaviours; `curl` sees
markup. There is no component test for any of the four new pieces — they are the
kind of thing Testing Library covers well, and adding those is the obvious
follow-up.

**`/studio` is 297 kB First Load JS**, up ~14 kB from `cmdk` and the new
components. Consistent with Sprint 16's finding that this route is dominated by
Clerk's client SDK.

---

## Remaining gaps

| #   | Gap                                                                                                                                                                                                        | Severity |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | **No tests for any new component.** Palette, shortcuts, resize and rail are all untested.                                                                                                                  | High     |
| 2   | **Asset Library still missing** — the audit's oldest open UI item.                                                                                                                                         | Medium   |
| 3   | **Named drafts do not exist.** Params persist; a draft list does not.                                                                                                                                      | Medium   |
| 4   | **Audio and text remain non-functional.** The rail is honest about it; that does not make them work.                                                                                                       | Medium   |
| 5   | **Resizing is desktop-only** (`xl` and up). Below that the regions are tabbed, so a divider would control a layout not on screen — deliberate, but it means the feature is invisible to most mobile users. | Low      |
| 6   | **`/studio` at 297 kB.** Reducing it means moving profile mutations off Clerk's client SDK.                                                                                                                | Medium   |

---

## Honest summary

The studio now has the things a workspace needs and was missing: a way to move
between modalities, a way to reach any command without hunting, keys for the
things done repeatedly, and a layout the user can shape and keep.

It does **not** have an asset library or a timeline, and I did not build
half-versions of either to close a checklist — one is a feature that belongs
elsewhere, the other is a control for a concept this product does not have.

The most valuable thing in this sprint may be the smallest: a heading-level skip
that had been failing in CI since Sprint 17 is now fixed, and the build failure I
introduced with the tooltip was caught by the production build rather than by a
user.
