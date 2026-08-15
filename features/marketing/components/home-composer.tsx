"use client";

import { ArrowRight, ImageIcon, Video } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Reveal, Section } from "@/features/marketing/components/section";
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
 * ## Why the modality switch is only Image and Video
 *
 * Audio exists and works, but nobody arrives at a landing page wanting to
 * describe a sound. Two options is a decision; three is a menu.
 */
export function HomeComposer() {
  const { composer } = useCopy();

  const [prompt, setPrompt] = useState("");
  const [modality, setModality] = useState<"image" | "video">("image");

  /**
   * Double-encoded, and that is correct rather than a mistake.
   *
   * The inner `encodeURIComponent` protects the prompt's own `&` and `=` inside
   * the studio's query string; the outer one protects that whole string as the
   * value of Clerk's `redirect_url`. Encoding once lets a prompt containing an
   * ampersand truncate the destination.
   */
  const destination = (() => {
    const studio = prompt.trim()
      ? `/studio?prompt=${encodeURIComponent(prompt.trim())}&modality=${modality}`
      : "/studio";

    return `/sign-up?redirect_url=${encodeURIComponent(studio)}`;
  })();

  const options = [
    { id: "image" as const, icon: ImageIcon },
    { id: "video" as const, icon: Video },
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
                  onClick={() => setModality(id)}
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
