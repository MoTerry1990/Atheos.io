# Design System

The live gallery is at **`/design-system`** — every component rendered with the
real code, in whichever theme is active. Start there. This document covers the
rules and the reasoning that a gallery cannot show.

Tokens live in [`styles/globals.css`](../styles/globals.css). Components live in
`components/ui` (primitives) and `components/layout` (structure).

---

## The one rule

**Components reference roles, never raw scales.**

```tsx
<div className="bg-surface text-muted-foreground" />   // yes
<div className="bg-neutral-900 text-neutral-400" />    // no
```

`bg-neutral-900` is a fact about a colour. `bg-surface` is a statement about
purpose. Only the second one survives a theme change, and that indirection is
the entire reason two themes work from one set of components.

If the role you need does not exist, add it to `globals.css`. Do not reach past
the layer.

---

## Token architecture

Three layers, in this order in the stylesheet:

| Layer                              | What                      | Example                                            |
| ---------------------------------- | ------------------------- | -------------------------------------------------- |
| **1. Scales** (`@theme`)           | Raw values, semantic-free | `--color-brand-500`, `--text-2xl`, `--ease-spring` |
| **2. Roles** (`:root` / `.dark`)   | Purpose, mapped per theme | `--surface-raised`, `--muted-foreground`           |
| **3. Utilities** (`@theme inline`) | Roles exposed as classes  | `bg-surface-raised`, `text-muted-foreground`       |

`@theme inline` matters: it compiles the utility to a `var()` reference rather
than to a snapshot of the current value, which is what lets one class respond to
the theme at runtime.

### Colour

Every colour is `oklch`. In hex, equal numeric steps produce visibly uneven
jumps — a palette with a muddy patch in the middle. In oklch a step is a step.

Neutrals carry a trace of the brand hue (`300°`). A true grey beside a saturated
violet reads as dirty; the tint is what makes the interface feel considered
rather than assembled.

**Dark mode inverts elevation.** Surfaces get _lighter_ as they rise, where the
light theme's get darker. Copying light-mode elevation into dark mode is exactly
what makes dark themes look muddy.

Both themes are measured against WCAG AA:

| Pair                                     | Light | Dark |
| ---------------------------------------- | ----- | ---- |
| `foreground` / `background`              | 20.1  | 19.8 |
| `muted-foreground` / `background`        | 4.8   | 8.0  |
| `primary-foreground` / `primary`         | 5.8   | 5.0  |
| `destructive-foreground` / `destructive` | 4.7   | —    |

AA requires 4.5 for body text. `muted-foreground` on light sits at 4.8 — it has
the least headroom in the system, so darken it before adding anything on top of
it.

### Typography

Two families. A third is a decision nobody can defend six months later.

The scale runs on roughly a 1.25 ratio, with line heights tightening as size
grows — large text needs proportionally less leading. Display sizes carry
negative tracking; without it they look loose and amateurish.

`Heading` separates **`as`** (element, for the document outline) from **`size`**
(appearance). Coupling them is what forces designers to misuse heading levels to
get a size they want, which quietly wrecks screen-reader navigation.

### Spacing

**Gaps are applied by parents, never by children.** A component that sets its own
`mb-4` decides the spacing of every context it is ever dropped into, and you end
up with `last:mb-0` scattered everywhere to undo it.

Use `Stack`, `Inline` and `Grid`. The gap scale is deliberately seven steps —
enough to build anything, few enough that two engineers pick the same one.

### Elevation, gradients, glow

Shadows are **layered** — a tight contact shadow plus a soft ambient one —
because that is what real objects cast. One blurry drop shadow is the single
clearest tell of an interface that was not art-directed.

Elevation is named by intent (`elevation-floating`) rather than by value, so
"how high is a dropdown" is answered once.

**Three gradients exist, and only three:**

- `bg-gradient-brand` — the signature. Headlines, the primary action.
- `bg-gradient-brand-subtle` — tinted fills, icon chips.
- `bg-aurora` — ambient background wash. **Never behind body text**; it destroys
  the contrast ratio the table above promises.

A gradient per component is how an interface stops looking designed and starts
looking decorated.

### Motion

Durations are 80–400ms. Anything longer is something the user waits through on
every interaction, hundreds of times a session.

Elements animate **in**; exits are near-instant. An animation you are waiting to
finish is friction.

Reduced motion is handled globally by `MotionProvider`
(`<MotionConfig reducedMotion="user">`), which suppresses transforms while
letting opacity animate.

> **Do not write `initial={{ y: reduced ? 0 : 12 }}`.** The server cannot know
> the user's motion preference, so branching on `useReducedMotion()` inside
> `initial` renders different inline styles on server and client. React reports a
> hydration mismatch and does **not** patch style mismatches up — elements can be
> left stuck at `opacity: 0`. This was a real bug here, caught by rendering the
> page rather than by the build. `useReducedMotion()` is fine for `whileHover`,
> `whileTap` and stagger timing, none of which touch the first render.

---

## Components

### Buttons

Nine variants. `gradient` and `glow` carry the futuristic look and are for **the
single primary action on a screen** — a page of glowing buttons has no primary
action at all.

`loading` disables the button and shows a spinner while **keeping the label**.
Swapping the label for a bare spinner changes the button's width mid-interaction
and the layout jumps under the user's cursor.

Every variant scales to `0.98` on press. On touch there is no hover state to
confirm a hit, so a press with no physical response feels broken.

### Inputs

Always wrap a control in `Field`. It generates the id, associates the label,
points `aria-describedby` at whichever of hint/error is showing, and sets
`aria-invalid`. Done by hand at every call site, that gets done correctly at
about half of them.

`Field` takes a render prop, so it works with any control — input, textarea,
select, or a third-party combobox — rather than only the ones anticipated here.

Inputs are `text-base` below `sm`. Anything smaller makes iOS Safari zoom the
viewport on focus, which users experience as the page lurching sideways.

### Cards

Four surfaces: `default`, `glass`, `gradient`, `ghost`. `interactive` is a
separate prop because any of them can be clickable — and the hover lift is
suppressed under `motion-reduce` and does not fire on touch, where a stuck hover
state is worse than none.

### Tables

**Below `md`, each row becomes a stacked card** of label/value pairs. The usual
answers are all worse: horizontal scroll hides columns behind a gesture nobody
discovers, squeezing produces unreadable columns, and dropping columns silently
loses data.

The cost is that row content appears twice in the markup. For the tens of rows a
UI table should show, that is the right trade.

`DataTable` is presentational. Sorting, filtering and selection belong to the
caller — baking them in would fix a data-fetching strategy into a display
component.

### Overlays

All Radix-backed. Focus trapping, focus restoration, escape handling and scroll
locking are behaviours you do not want to reimplement, and getting them subtly
wrong is invisible until someone navigates by keyboard.

- **Dialog** — a task. Has a form, can be dismissed.
- **AlertDialog** — a decision that cannot be undone. No dismiss on outside
  click, on purpose.
- **Sheet** — the mobile drawer.
- **Tooltip** — supplementary only. **Never the sole source of a label**;
  tooltips do not exist on touch devices. One `TooltipProvider` at the root, or
  the shared open-delay resets on every hover.

### Feedback

| Situation                    | Use                           |
| ---------------------------- | ----------------------------- |
| Shape of the result is known | `Skeleton`                    |
| Shape unknown, under ~1s     | `Spinner`                     |
| Blocking a visible region    | `LoadingOverlay`              |
| Work with a known total      | `ProgressBar value={n}`       |
| Work with no knowable total  | `ProgressBar` (indeterminate) |

A skeleton beats a spinner whenever the layout is predictable: it shows the page
_arriving_ rather than the page _waiting_. Match the real dimensions — a skeleton
that resolves to a different size makes the jump worse than no skeleton at all.

The indeterminate progress bar matters more than it looks. Video generation
reports nothing useful for minutes, and a determinate bar frozen at 0% reads as a
hung process. An honestly indeterminate bar beats one that lies.

**Toasts:** failures persist, successes fade. A missed success costs nothing; a
missed error costs the user ten minutes wondering why nothing happened. Never put
a required decision in a toast — they time out and stack.

**Empty and error states are not edge cases.** Every account starts empty and
generation regularly fails, so `EmptyState` and `ErrorState` are the first thing
most users see. Both take an action, because a dead end with no next step is the
actual failure.

### Navigation

`Sidebar` is a persistent rail at `lg` and up, collapsing to icons with the state
persisted in `useUIStore`. Below `lg` it becomes `SidebarDrawer` — a drawer, not
a squeezed sidebar, because on a phone there is no room for permanent chrome.

The drawer closes on navigation. Leaving it open after a route change is the
classic mobile bug: the user taps a link, the page changes underneath, and the
menu is still covering it.

Active state is communicated three ways — colour, a left rail, and
`aria-current`. Colour alone fails for a colour-blind user; `aria-current` is
what a screen reader announces.

### Icons

`aria-hidden` is the **default**; passing `label` opts into the accessible
variant. The safe behaviour is what you get by doing nothing, which is the only
way this stays correct across hundreds of call sites.

Stroke width is pinned at 1.75. Lucide scales stroke with size by default, which
makes large icons look heavy and small ones spindly.

---

## Responsive

Breakpoints: `xs` 24rem · `sm` 40rem · `md` 48rem · `lg` 64rem · `xl` 80rem ·
`2xl` 96rem · `3xl` 120rem.

`xs` exists for small phones. `3xl` exists because a creative tool is used on
large displays and an asset grid should keep filling them.

Verified at 375px: no horizontal overflow, the table swaps to cards, the sidebar
becomes a drawer, and no element exceeds the viewport width.

**Test at 375px before calling anything done.** It is where layouts break, and
it is a real device size, not a hypothetical.

---

## Adding a component

1. Check whether a Radix primitive exists — take the accessibility for free.
2. `npx shadcn@latest add <name>` puts it in `components/ui`. It is **our code**
   now; restyle it freely.
3. Use roles, never scales.
4. Variants via `cva`. Every `className` prop goes through `cn()`, or callers
   cannot reliably override anything.
5. Add it to `/design-system` in the same commit. A component that is not in the
   gallery does not exist as far as the next person is concerned.
6. Check it at 375px and in both themes.
