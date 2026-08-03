"use client";

import { Check, Clock, Download, RefreshCw, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MarketplaceListing } from "@/features/marketplace/lib/api";
import { KIND_LABELS, itemSize } from "@/services/marketplace/types";
import { cn } from "@/lib/utils";

/**
 * One marketplace item.
 *
 * ## The card says what is inside, not how popular it is
 *
 * "12 prompts", not "4.8 stars, 3.2k downloads". There are no third-party
 * publishers yet, so any social proof here would be invented — and a
 * marketplace's numbers are the first thing a user trusts and the first thing
 * they would find out was untrue. Size and contents are facts we actually have.
 *
 * ## A swatch, not cover art
 *
 * Every item would otherwise need an illustration, and generating them would
 * mean shipping AI output as if a designer had made it. The accent hue plus the
 * kind badge is enough to make a grid scannable, and it is honest about being a
 * placeholder for something a publisher would supply.
 */
export function ItemCard({
  item,
  onOpen,
  onToggleFavorite,
  onInstall,
  busy,
}: {
  item: MarketplaceListing;
  onOpen: (item: MarketplaceListing) => void;
  onToggleFavorite: (item: MarketplaceListing) => void;
  onInstall: (item: MarketplaceListing) => void;
  busy?: boolean;
}) {
  const size = itemSize(item);

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors",
        "focus-within:border-primary/40 hover:border-border/70",
        busy && "opacity-60",
      )}
    >
      <div
        aria-hidden
        className="h-20 shrink-0"
        style={{
          backgroundImage: `linear-gradient(135deg, oklch(0.68 0.19 ${item.hue} / 0.9), oklch(0.45 0.16 ${(item.hue + 50) % 360} / 0.85))`,
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" size="sm">
            {KIND_LABELS[item.kind]}
          </Badge>
          {item.official ? (
            <Badge variant="brand" size="sm">
              Atheos
            </Badge>
          ) : null}
          {!item.usable ? (
            <Badge variant="warning" size="sm">
              <Clock className="size-3" aria-hidden />
              Not yet usable
            </Badge>
          ) : null}
        </div>

        {/* `h2`, not `h3`. These are the page's primary content, directly
            under its `h1` — an `h3` here skipped a level and broke sequential
            heading navigation for the sake of looking smaller, which is what
            the `size`/`as` split on `Heading` exists to avoid. */}
        <h2 className="text-sm font-medium">
          {/* The whole card opens the detail sheet, via an overlay pseudo-element
              on the title.

              `after:z-[1]` is load-bearing and was missing at first: without a
              z-index the overlay paints beneath the siblings that follow it in
              the DOM — the description, the meta line — so the middle of the
              card was dead and only the title text itself was clickable. A 22px
              strip is both a broken affordance and below WCAG 2.5.8's 24px.

              The footer sits at `z-10`, above this, so Download and the star
              stay reachable. */}
          <button
            type="button"
            onClick={() => onOpen(item)}
            className="rounded text-left after:absolute after:inset-0 after:z-[1] focus-visible:outline-none"
          >
            {item.title}
          </button>
        </h2>

        <p className="line-clamp-2 text-xs text-muted-foreground">
          {item.summary}
        </p>

        <p className="mt-auto pt-1 text-2xs text-muted-foreground tabular-nums">
          {item.category}
          {size > 1 ? (
            <>
              <span aria-hidden> · </span>
              {size}{" "}
              {item.kind === "PROMPT_PACK"
                ? "prompts"
                : item.kind === "STYLE_PACK"
                  ? "styles"
                  : "voices"}
            </>
          ) : null}
        </p>
      </div>

      <div className="relative z-10 flex items-center gap-1.5 border-t border-border p-2">
        <Button
          size="xs"
          variant={item.installed ? "outline" : "secondary"}
          className="flex-1"
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
            ? "Update"
            : item.installed
              ? "Installed"
              : "Download"}
        </Button>

        <Button
          size="icon-xs"
          variant={item.favorited ? "glow" : "ghost"}
          onClick={() => onToggleFavorite(item)}
          aria-pressed={item.favorited}
          aria-label={
            item.favorited
              ? `Remove ${item.title} from favourites`
              : `Add ${item.title} to favourites`
          }
        >
          <Star
            className={item.favorited ? "fill-current" : undefined}
            aria-hidden
          />
        </Button>
      </div>
    </article>
  );
}
