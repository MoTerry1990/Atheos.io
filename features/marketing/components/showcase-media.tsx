"use client";

import { Pause, Play } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import type { ShowcaseTab } from "@/features/marketing/content";
import { cn } from "@/lib/utils";

/**
 * The media beside each showcase panel.
 *
 * ## Why only one can ever be playing
 *
 * The panel is keyed on the tab id in `ai-showcase.tsx`, so switching tabs
 * unmounts the whole subtree. React tears the `<video>` or `<audio>` element
 * down with it, and a destroyed element cannot keep playing — the rule is
 * enforced by the tree rather than by a listener that has to remember to fire.
 * That also resets position and mute state, because the next mount starts from
 * the component's initial state.
 *
 * ## Nothing is fetched until its tab is open
 *
 * Same mechanism. The element for a tab that has never been opened does not
 * exist, so its file is never requested. The image tab is the default and is
 * the only one that costs anything on first paint.
 *
 * ## The frame
 *
 * A single rounded container with a hairline ring, shared by all three, so the
 * three tabs read as one surface rather than three unrelated widgets. Aspect
 * ratio is fixed per media so switching tabs does not resize the column.
 */

/** Shared chrome for every control in here. */
const CONTROL =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-border/60 bg-background/80 px-4 text-sm font-medium text-foreground backdrop-blur-sm transition-colors hover:bg-background focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none";

const FRAME =
  "relative overflow-hidden rounded-xl bg-surface-sunken ring-1 ring-white/10";

export function ShowcaseMedia({ panel }: { panel: ShowcaseTab }) {
  if (panel.video) return <ShowcaseVideo panel={panel} />;
  return <ShowcaseStill panel={panel} />;
}

/* -------------------------------------------------------------------------- */
/* Image                                                                       */
/* -------------------------------------------------------------------------- */

function ShowcaseStill({ panel }: { panel: ShowcaseTab }) {
  return (
    <figure className="space-y-3">
      <div className={cn(FRAME, "aspect-[16/9]")}>
        <Image
          src={`/marketing/${panel.image}.webp`}
          alt={`AI generation: ${panel.mediaCaption}`}
          fill
          sizes="(max-width: 1024px) 100vw, 50vw"
          /**
           * 90, not the default 75. The source is already compressed WebP and
           * re-encoding it at 75 compounds the loss — which is what soft
           * marketing imagery is made of.
           */
          quality={90}
          className="object-cover"
        />
      </div>
      <figcaption className="text-xs text-muted-foreground">
        {panel.mediaCaption}
      </figcaption>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* Video                                                                       */
/* -------------------------------------------------------------------------- */

function ShowcaseVideo({ panel }: { panel: ShowcaseTab }) {
  const video = panel.video!;
  const ref = useRef<HTMLVideoElement>(null);

  /**
   * Both follow the element rather than leading it.
   *
   * Autoplay can be refused, a tab switch can pause, and a user can use the
   * native context menu. Anything that reads local state to describe the
   * element ends up describing something that is not happening.
   */
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const sync = () => {
      setPlaying(!element.paused);
    };
    for (const event of ["play", "pause"])
      element.addEventListener(event, sync);
    sync();

    return () => {
      for (const event of ["play", "pause"])
        element.removeEventListener(event, sync);
    };
  }, []);

  function togglePlay() {
    const element = ref.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => undefined);
    else element.pause();
  }

  return (
    <figure className="space-y-3">
      <div className={cn(FRAME, "aspect-[16/9]")}>
        <video
          ref={ref}
          poster={video.poster}
          // Muted autoplay is the only autoplay a browser permits, and the
          // loop is a ping-pong so it does not cut on repeat.
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={video.label}
          className="size-full object-cover"
        >
          <source src={video.src} type="video/mp4" />
        </video>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          className={CONTROL}
          aria-label={playing ? "Pause video" : "Play video"}
        >
          {playing ? (
            <Pause className="size-4" aria-hidden />
          ) : (
            <Play className="size-4" aria-hidden />
          )}
          {playing ? "Pause" : "Play"}
        </button>
      </div>

      {/**
       * The claim, stated exactly.
       *
       * The picture is model output; the sound is a separately generated Foley
       * ambience mixed in locally. No model in the catalogue that is approved
       * for commercial publication generates audio, so calling this "native
       * audio" would be false. `docs/SHOWCASE-PROVENANCE.md` carries both
       * source hashes.
       */}
      <figcaption className="text-xs text-muted-foreground">
        {panel.mediaCaption}
      </figcaption>
    </figure>
  );
}
