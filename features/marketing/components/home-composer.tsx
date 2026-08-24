"use client";

import { ArrowRight, AudioLines, ImageIcon, Video } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Reveal, Section } from "@/features/marketing/components/section";
import { COMPOSER_MODALITIES } from "@/features/marketing/content";
import { useCopy } from "@/features/marketing/i18n";
import { cn } from "@/lib/utils";

/**
 * The prompt field under the hero.
 *
 * ## It does not generate, and it must not look like it does
 *
 * This is the single most important constraint on the component. A prompt box
 * on a landing page invites the reader to type and press the button; if the
 * result is a sign-up wall they did not see coming, the page has taken their
 * idea and charged them a registration for it. That is the pattern this
 * deliberately does not use.
 *
 * So: the button says "Start with this" rather than "Generate", and the line
 * beneath it states plainly that signing up is where this goes and that it is
 * free. Nobody should be surprised by what the button does.
 *
 * ## The prompt travels
 *
 * It is carried through Clerk's `redirect_url` into the studio, so the thing
 * somebody typed on the homepage is waiting in the field when they arrive. A
 * composer that discards the prompt at the sign-up boundary is worse than no
 * composer — it asks for effort and then throws it away.
 *
 * ## All three modalities, because all three work
 *
 * Score and Foley are live models, not roadmap. Offering Image and Video while
 * the showcase directly below advertises Audio would be the page contradicting
 * itself within one scroll.
 *
 * ## They are tabs, and they behave like tabs
 *
 * They used to be three `aria-pressed` buttons in a plain div. That announces
 * "Image, toggle button, pressed" — three unrelated switches, one of which
 * happens to be on — when what is actually happening is a single choice among
 * three, each swapping the model list, the aspect ratios and the placeholder
 * beneath it. A screen-reader user was told the wrong thing about the control,
 * and a keyboard user had to Tab through all three rather than arrowing
 * between them.
 *
 * So: `role="tablist"`, roving `tabindex`, arrow keys, Home and End, and a
 * `tabpanel` around the fields the choice governs.
 *
 * **Automatic activation** — arrowing to a tab selects it — rather than
 * requiring Enter. The APG allows either and recommends automatic when
 * switching is cheap and has no side effects. Here it changes two `<select>`
 * lists and a placeholder in local state; there is no request, nothing to
 * cancel, and the prompt is carried across untouched.
 *
 * The ids are prefixed `composer-`. `ai-showcase.tsx` further down the page
 * has its own tablist using `tab-image` and `panel-image`, and two elements
 * sharing an id would break `aria-controls` on whichever one rendered second.
 */
export function HomeComposer() {
  const { composer } = useCopy();

  const [prompt, setPrompt] = useState("");
  const [modality, setModality] = useState<"image" | "video" | "audio">(
    "image",
  );

  const config =
    COMPOSER_MODALITIES.find((entry) => entry.id === modality) ??
    COMPOSER_MODALITIES[0]!;

  /**
   * Model and ratio are held per modality and reset when it changes.
   *
   * Keeping a video model selected while the reader switches to Image would
   * carry an id the studio cannot use for that operation. Resetting to the
   * first option is the only choice that is always valid.
   */
  const [model, setModel] = useState(config.models[0]!.id);
  const [ratio, setRatio] = useState(config.aspectRatios[0] ?? "");

  function chooseModality(next: "image" | "video" | "audio") {
    const target = COMPOSER_MODALITIES.find((entry) => entry.id === next);
    if (!target) return;

    setModality(next);
    setModel(target.models[0]!.id);
    setRatio(target.aspectRatios[0] ?? "");
  }

  /**
   * Double-encoded, and that is correct rather than a mistake.
   *
   * The inner `encodeURIComponent` protects the prompt's own `&` and `=` inside
   * the studio's query string; the outer one protects that whole string as the
   * value of Clerk's `redirect_url`. Encoding once lets a prompt containing an
   * ampersand truncate the destination.
   */
  const destination = (() => {
    const query = new URLSearchParams({ modality, model });
    if (prompt.trim()) query.set("prompt", prompt.trim());
    if (ratio) query.set("aspect", ratio);

    // `URLSearchParams` handles the inner encoding; the outer one protects the
    // whole string as the value of Clerk's `redirect_url`. Both are needed —
    // see tests/unit/home-composer.test.ts.
    return `/sign-up?redirect_url=${encodeURIComponent(`/studio?${query}`)}`;
  })();

  const options = [
    { id: "image" as const, icon: ImageIcon },
    { id: "video" as const, icon: Video },
    { id: "audio" as const, icon: AudioLines },
  ];

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /**
   * Arrow, Home and End, per the APG tabs pattern.
   *
   * Wraps at both ends: from the last tab, Right returns to the first. A
   * three-item tablist that stops dead at the edges makes somebody reverse
   * direction to reach a neighbour that is one key away.
   *
   * Focus is moved explicitly because `tabindex` is roving — only the selected
   * tab is in the tab order, so the browser will not move focus for us.
   */
  function onTabKeyDown(event: React.KeyboardEvent, index: number) {
    const keys: Record<string, number> = {
      ArrowRight: (index + 1) % options.length,
      ArrowLeft: (index - 1 + options.length) % options.length,
      Home: 0,
      End: options.length - 1,
    };

    const next = keys[event.key];
    if (next === undefined) return;

    event.preventDefault();
    chooseModality(options[next]!.id);
    tabRefs.current[next]?.focus();
  }

  return (
    <Section>
      <Reveal>
        <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-card p-4 elevation-raised sm:p-5">
          <div
            role="tablist"
            aria-label={composer.promptLabel}
            className="mb-3 flex gap-2"
          >
            {options.map(({ id, icon: Icon }, index) => {
              const selected = id === modality;
              const label =
                composer.modalities.find((m) => m.id === id)?.label ?? id;

              return (
                <Button
                  key={id}
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                  type="button"
                  size="sm"
                  role="tab"
                  id={`composer-tab-${id}`}
                  aria-selected={selected}
                  aria-controls={`composer-panel-${id}`}
                  // Roving: exactly one tab is in the tab order, so Tab moves
                  // past the whole group rather than through it.
                  tabIndex={selected ? 0 : -1}
                  variant={selected ? "default" : "outline"}
                  onClick={() => chooseModality(id)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                  className={cn(
                    // 44px on touch, where the tab is the primary control of
                    // this card. `sm:` returns it to the compact size on a
                    // pointer, where precision is not the constraint.
                    //
                    // `min-h-`, not `h-`: the Button's own `size="sm"` height
                    // wins the cascade against another `height` utility — the
                    // class list showed `h-11` and the element still measured
                    // 36px — and `min-height` is not competing for the same
                    // property, so it applies.
                    "min-h-11 sm:min-h-9",
                    !selected && "text-muted-foreground",
                  )}
                >
                  <Icon />
                  {label}
                </Button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={`composer-panel-${modality}`}
            aria-labelledby={`composer-tab-${modality}`}
            // Not focusable: every child is, so a tabpanel stop would be an
            // extra Tab press that lands on nothing actionable.
            tabIndex={-1}
          >
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={composer.placeholders[modality]}
              rows={3}
              maxLength={2000}
              /**
               * Grammarly attaches to this field exactly as it does to the
               * studio prompt — it is the most prose-like box on the site. A
               * measured test caught the caret arriving underneath the badge
               * at the end of a long prompt.
               */
              overlayRight
              // `px-0` used to be here, which put the first character of every
              // homepage prompt flush against the card edge. The border and the
              // ring belong to the card, but the padding belongs to the text.
              className="resize-y border-0 bg-transparent shadow-none focus-visible:ring-0"
              // A real label rather than the placeholder as one: the
              // placeholder changes with the modality and disappears the moment
              // somebody types, so a screen reader would lose the field's name
              // exactly when it is being used.
              aria-label={composer.promptLabel}
            />

            {/* Model and ratio. Native selects rather than a styled dropdown:
              they are two controls on a marketing page, they are keyboard- and
              screen-reader-correct for free, and a custom listbox here would
              ship JavaScript to solve a problem the platform already solved. */}
            {/**
             * The labels are visible at every width, and stack above their
             * control below `sm`.
             *
             * They were `sr-only sm:not-sr-only` — announced to a screen reader,
             * invisible to a sighted phone user, who got two unlabelled
             * dropdowns reading "Flux Fast" and "1:1". Nothing was ever
             * *truncated*: an `sr-only` element is clipped to 1px by design, so
             * a naive overflow check reports it as clipped and the earlier audit
             * recorded truncation that did not exist.
             *
             * Side by side they do not fit — the row is 309px of a 375px
             * viewport with the labels hidden, and showing them needs about 90px
             * more. Stacking is what buys the space, rather than shrinking the
             * type.
             */}
            <div className="mt-3 flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:gap-2">
                <span>Model</span>
                <select
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  // 44px on touch, matching the tablist above it. `min-h-`, not
                  // `h-`, for the reason documented on those tabs.
                  className="min-h-11 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:min-h-0"
                >
                  {config.models.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {/* Absent, not disabled, for audio — it has no aspect ratio, and a
                greyed-out control invites the reader to wonder what they did
                wrong. */}
              {config.aspectRatios.length > 0 ? (
                <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:gap-2">
                  <span>Ratio</span>
                  <select
                    value={ratio}
                    onChange={(event) => setRatio(event.target.value)}
                    className="min-h-11 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none sm:min-h-0"
                  >
                    {config.aspectRatios.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              {/* Stated before the click, not after it — and only the half that
                is true. An empty field has no prompt to carry, so promising to
                carry one would be a claim the next screen disproves. */}
              <p className="text-xs text-muted-foreground">
                {prompt.trim() ? composer.note : composer.noteEmpty}
              </p>

              <Button asChild variant="gradient">
                {/* A plain anchor, not `next/link`: `/sign-up` is a Clerk
                  catch-all whose own routing takes over, and prefetching a
                  parameterised auth URL warms a route that changes on every
                  keystroke. */}
                <a href={destination}>
                  {composer.cta}
                  <ArrowRight />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
