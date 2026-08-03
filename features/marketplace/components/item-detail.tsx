"use client";

import { Check, Clock, Download, RefreshCw, Star, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { MarketplaceListing } from "@/features/marketplace/lib/api";
import { KIND_LABELS } from "@/services/marketplace/types";

/**
 * What an item actually contains.
 *
 * ## Everything is shown before it is installed
 *
 * Every prompt, every style fragment, every trait — in full, not summarised.
 * The whole premise of the studio's preset design (Sprint 5) is that text added
 * to a prompt must be readable, because a product that quietly injects styling
 * produces a user who cannot work out why their prompt behaves differently from
 * the same prompt typed elsewhere. A marketplace makes that worse by an order
 * of magnitude: it is somebody else's text, and installing it sight-unseen is
 * how a workspace fills up with things nobody can explain.
 *
 * It is also the honest answer to "why would I install this" — the contents
 * are the entire product.
 *
 * ## A sheet, not a page
 *
 * Browsing a marketplace is comparing things. A route change per item loses the
 * scroll position and the filter, and makes going back a decision.
 */
export function ItemDetail({
  item,
  onClose,
  onToggleFavorite,
  onInstall,
  onUninstall,
  busy,
}: {
  item: MarketplaceListing | null;
  onClose: () => void;
  onToggleFavorite: (item: MarketplaceListing) => void;
  onInstall: (item: MarketplaceListing) => void;
  onUninstall: (item: MarketplaceListing) => void;
  busy?: boolean;
}) {
  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {item ? (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" size="sm">
                  {KIND_LABELS[item.kind]}
                </Badge>
                {item.official ? (
                  <Badge variant="brand" size="sm">
                    Atheos
                  </Badge>
                ) : null}
                <Badge variant="default" size="sm">
                  {item.category}
                </Badge>
              </div>
              <SheetTitle className="mt-2">{item.title}</SheetTitle>
              <SheetDescription>{item.description}</SheetDescription>
            </SheetHeader>

            <div className="space-y-6 px-4 pb-6">
              {!item.usable ? (
                <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs">
                  <Clock
                    className="mt-0.5 size-3.5 shrink-0 text-warning"
                    aria-hidden
                  />
                  <span>{item.unusableReason}</span>
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant={item.installed ? "outline" : "gradient"}
                  loading={busy}
                  onClick={() => onInstall(item)}
                >
                  {item.updateAvailable ? (
                    <RefreshCw />
                  ) : item.installed ? (
                    <Check />
                  ) : (
                    <Download />
                  )}
                  {item.updateAvailable
                    ? "Update to the latest version"
                    : item.installed
                      ? "Installed"
                      : "Download"}
                </Button>

                <Button
                  variant={item.favorited ? "glow" : "outline"}
                  onClick={() => onToggleFavorite(item)}
                  aria-pressed={item.favorited}
                >
                  <Star
                    className={item.favorited ? "fill-current" : undefined}
                  />
                  {item.favorited ? "Favourited" : "Favourite"}
                </Button>

                {item.installed ? (
                  <Button
                    variant="ghost"
                    onClick={() => onUninstall(item)}
                    className="text-muted-foreground"
                  >
                    <Trash2 />
                    Remove
                  </Button>
                ) : null}
              </div>

              <Contents item={item} />

              {item.tags.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {item.tags.map((tag) => (
                    <li
                      key={tag}
                      className="rounded-full bg-secondary px-2 py-0.5 text-2xs text-secondary-foreground"
                    >
                      {tag}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-2xs font-medium tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {children}
    </section>
  );
}

function Contents({ item }: { item: MarketplaceListing }) {
  const payload = item.payload;

  switch (payload.kind) {
    case "TEMPLATE": {
      const t = payload.template;
      return (
        <Section
          title="What it sets up"
          hint="Loaded into the composer. Everything stays editable."
        >
          <dl className="space-y-3 rounded-lg border border-border p-3 text-xs">
            <div>
              <dt className="text-muted-foreground">Prompt</dt>
              <dd className="mt-0.5 font-mono leading-relaxed">{t.prompt}</dd>
            </div>
            {t.negativePrompt ? (
              <div>
                <dt className="text-muted-foreground">Negative prompt</dt>
                <dd className="mt-0.5 font-mono leading-relaxed">
                  {t.negativePrompt}
                </dd>
              </div>
            ) : null}
            {t.styleFragments.map((fragment) => (
              <div key={fragment}>
                <dt className="text-muted-foreground">Style</dt>
                <dd className="mt-0.5 font-mono leading-relaxed">{fragment}</dd>
              </div>
            ))}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground tabular-nums">
              <span>{t.aspectRatio}</span>
              {t.durationSeconds ? <span>{t.durationSeconds}s</span> : null}
              {t.cameraMotion ? <span>{t.cameraMotion}</span> : null}
              {t.camera?.shot ? <span>{t.camera.shot}</span> : null}
              {t.camera?.lens ? <span>{t.camera.lens}</span> : null}
              {t.camera?.lighting ? <span>{t.camera.lighting}</span> : null}
            </div>
          </dl>
        </Section>
      );
    }

    case "PROMPT_PACK":
      return (
        <Section
          title={`${payload.prompts.length} prompts`}
          hint="Curly braces mark what you replace."
        >
          <ul className="space-y-2">
            {payload.prompts.map((entry) => (
              <li
                key={entry.id}
                className="rounded-lg border border-border p-3 text-xs"
              >
                <p className="font-medium">{entry.title}</p>
                <p className="mt-1 font-mono leading-relaxed text-muted-foreground">
                  {entry.prompt}
                </p>
                {entry.negativePrompt ? (
                  <p className="mt-1.5 font-mono text-2xs text-muted-foreground">
                    avoid: {entry.negativePrompt}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      );

    case "STYLE_PACK":
      return (
        <Section
          title={`${payload.styles.length} styles`}
          hint="Each one appends this exact text to your prompt."
        >
          <ul className="space-y-2">
            {payload.styles.map((style) => (
              <li
                key={style.id}
                className="flex gap-2.5 rounded-lg border border-border p-3 text-xs"
              >
                <span
                  aria-hidden
                  className="mt-1 size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: `oklch(0.7 0.18 ${style.hue})` }}
                />
                <span className="min-w-0">
                  <span className="block font-medium">{style.name}</span>
                  <span className="mt-0.5 block font-mono leading-relaxed text-muted-foreground">
                    {style.fragment}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      );

    case "CHARACTER":
      return (
        <Section
          title="The character"
          hint="Anchored on silhouette and clothing rather than a described face — faces re-render differently every time, which is what actually breaks consistency."
        >
          <div className="space-y-3 rounded-lg border border-border p-3 text-xs">
            <p className="font-mono leading-relaxed">
              {payload.character.anchor}
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {payload.character.traits.map((trait) => (
                <li
                  key={trait}
                  className="rounded-full bg-secondary px-2 py-0.5 text-2xs text-secondary-foreground"
                >
                  {trait}
                </li>
              ))}
            </ul>
            {payload.character.seed !== undefined ? (
              <p className="text-2xs text-muted-foreground tabular-nums">
                Reference seed {payload.character.seed}
              </p>
            ) : null}
          </div>
        </Section>
      );

    case "VOICE_PACK":
      return (
        <Section title={`${payload.voices.length} voices`}>
          <ul className="space-y-2">
            {payload.voices.map((voice) => (
              <li
                key={voice.id}
                className="rounded-lg border border-border p-3 text-xs"
              >
                <p className="font-medium">{voice.name}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {voice.description}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      );
  }
}
