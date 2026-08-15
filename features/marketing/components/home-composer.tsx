"use client";

import { ArrowRight, AudioLines, ImageIcon, Video } from "lucide-react";
import { useState } from "react";

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

  return (
    <Section>
      <Reveal>
        <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-card p-4 elevation-raised sm:p-5">
          <div className="mb-3 flex gap-2">
            {options.map(({ id, icon: Icon }) => {
              const selected = id === modality;
              const label =
                composer.modalities.find((m) => m.id === id)?.label ?? id;

              return (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={selected ? "default" : "outline"}
                  aria-pressed={selected}
                  onClick={() => chooseModality(id)}
                  className={cn(!selected && "text-muted-foreground")}
                >
                  <Icon />
                  {label}
                </Button>
              );
            })}
          </div>

          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={composer.placeholder}
            rows={3}
            maxLength={2000}
            className="resize-y border-0 bg-transparent px-0 text-base focus-visible:ring-0"
            aria-label={composer.placeholder}
          />

          {/* Model and ratio. Native selects rather than a styled dropdown:
              they are two controls on a marketing page, they are keyboard- and
              screen-reader-correct for free, and a custom listbox here would
              ship JavaScript to solve a problem the platform already solved. */}
          <div className="mt-3 flex flex-wrap gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="sr-only sm:not-sr-only">Model</span>
              <select
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
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
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="sr-only sm:not-sr-only">Ratio</span>
                <select
                  value={ratio}
                  onChange={(event) => setRatio(event.target.value)}
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
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
            {/* Stated before the click, not after it. */}
            <p className="text-xs text-muted-foreground">{composer.note}</p>

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
      </Reveal>
    </Section>
  );
}
