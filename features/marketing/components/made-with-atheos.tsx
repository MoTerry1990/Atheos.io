"use client";

import { ArrowUpRight, Play } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { GeneratedImage } from "@/features/marketing/components/generated-image";
import {
  Reveal,
  Section,
  SectionHeading,
} from "@/features/marketing/components/section";
import { MADE_WITH_ATHEOS } from "@/features/marketing/content";
import { useCopy } from "@/features/marketing/i18n";
import { cn } from "@/lib/utils";

/**
 * The discovery block — real output, browsable, with the prompt attached.
 *
 * ## Only one video plays at a time, and only when it is on screen
 *
 * Six autoplaying videos is six simultaneous decodes, and on a laptop it is
 * audible as the fan. Three rules keep it to one:
 *
 *   1. A video is only *mounted with a source* once it has been near the
 *      viewport. Before that the card is its poster and nothing else, so an
 *      offscreen card costs one image.
 *   2. Playing is driven by hover or focus, never by arrival on screen.
 *   3. Starting one pauses whichever was playing, tracked in a ref shared by
 *      every card in the section.
 *
 * Leaving the viewport pauses too. A card that scrolls away mid-play is a
 * decode nobody is watching.
 *
 * ## Hover is not available on a phone
 *
 * So the same control is a button. `onFocus` covers keyboard, `onClick`
 * covers touch, and the play affordance is visible rather than implied —
 * "hover to play" is not an instruction a touch user can follow.
 *
 * ## Reduced motion means posters
 *
 * No video element is created at all. The prompt and the "Try this" action are
 * the point of the card; the motion is decoration on top of them.
 */
export function MadeWithAtheos() {
  const copy = useCopy();

  /**
   * The video currently playing, shared across cards.
   *
   * A ref rather than state: changing it must not re-render the section, and
   * the pause is a direct DOM call on an element another card owns.
   */
  const playing = useRef<HTMLVideoElement | null>(null);

  const [motionAllowed, setMotionAllowed] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setMotionAllowed(!query.matches);

    const onChange = (event: MediaQueryListEvent) =>
      setMotionAllowed(!event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const claim = useCallback((video: HTMLVideoElement) => {
    if (playing.current && playing.current !== video) {
      playing.current.pause();
    }
    playing.current = video;
  }, []);

  const release = useCallback((video: HTMLVideoElement) => {
    if (playing.current === video) playing.current = null;
  }, []);

  return (
    <Section id="made">
      <SectionHeading
        eyebrow={copy.made.eyebrow}
        title={copy.made.title}
        description={copy.made.description}
      />

      <Reveal delay={0.05} className="mt-12">
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MADE_WITH_ATHEOS.map((item) => (
            <li key={item.poster}>
              <MediaCard
                item={item}
                motionAllowed={motionAllowed}
                onClaim={claim}
                onRelease={release}
                playLabel={copy.made.play}
                tryLabel={copy.made.tryThis}
              />
            </li>
          ))}
        </ul>
      </Reveal>
    </Section>
  );
}

function MediaCard({
  item,
  motionAllowed,
  onClaim,
  onRelease,
  playLabel,
  tryLabel,
}: {
  item: (typeof MADE_WITH_ATHEOS)[number];
  motionAllowed: boolean;
  onClaim: (video: HTMLVideoElement) => void;
  onRelease: (video: HTMLVideoElement) => void;
  playLabel: string;
  tryLabel: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  /**
   * Whether this card has ever been near the viewport.
   *
   * Gates the `<source>`, not the `<video>`: an element with no source
   * downloads nothing, so a card below the fold costs exactly its poster until
   * the reader approaches it.
   */
  const [near, setNear] = useState(false);
  const [active, setActive] = useState(false);

  const isVideo = item.kind === "video";

  useEffect(() => {
    const node = cardRef.current;
    if (!node || !isVideo || !motionAllowed) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;

        if (entry.isIntersecting) {
          setNear(true);
          return;
        }

        // Gone from view — stop, whatever the pointer is doing. A card that
        // scrolled past while hovered would otherwise keep decoding.
        const video = videoRef.current;
        if (video) {
          video.pause();
          onRelease(video);
        }
        setActive(false);
      },
      // Starts loading a little before it arrives, so the first hover has
      // something to play rather than a spinner.
      { rootMargin: "200px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [isVideo, motionAllowed, onRelease]);

  function start() {
    const video = videoRef.current;
    if (!video) return;

    onClaim(video);
    setActive(true);
    // Rejects when the browser declines; the poster stays and nothing breaks.
    void video.play().catch(() => undefined);
  }

  function stop() {
    const video = videoRef.current;
    if (!video) return;

    video.pause();
    video.currentTime = 0;
    onRelease(video);
    setActive(false);
  }

  return (
    <div
      ref={cardRef}
      className="group relative overflow-hidden rounded-xl border border-border bg-card"
      onMouseEnter={isVideo && motionAllowed ? start : undefined}
      onMouseLeave={isVideo && motionAllowed ? stop : undefined}
    >
      {/* Aspect ratio on the container, not the media. The box is the right
          size before anything loads, so nothing below it moves. */}
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-surface-sunken">
        <GeneratedImage
          src={item.poster}
          prompt={item.prompt}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className={cn(
            "transition-opacity duration-500",
            active ? "opacity-0" : "opacity-100",
          )}
        />

        {isVideo && motionAllowed ? (
          <video
            ref={videoRef}
            muted
            loop
            playsInline
            // No `autoPlay`: playing is a decision made by hover, focus or tap.
            preload="none"
            aria-hidden
            className={cn(
              "absolute inset-0 size-full object-cover transition-opacity duration-500",
              active ? "opacity-100" : "opacity-0",
            )}
          >
            {near ? <source src={item.video} type="video/mp4" /> : null}
          </video>
        ) : null}

        {/* Touch and keyboard get a real control. "Hover to play" is not an
            instruction somebody on a phone can follow. */}
        {isVideo && motionAllowed ? (
          <button
            type="button"
            onClick={() => (active ? stop() : start())}
            onFocus={start}
            onBlur={stop}
            aria-label={playLabel}
            aria-pressed={active}
            className={cn(
              "absolute top-3 right-3 flex size-9 items-center justify-center rounded-full",
              "bg-background/70 text-foreground backdrop-blur-sm transition-opacity",
              "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
              active ? "opacity-0 group-hover:opacity-100" : "opacity-100",
            )}
          >
            <Play className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-2xs font-medium tracking-wider text-primary uppercase">
            {item.kind}
          </span>
          {/* Only when known. An invented model name on a card claiming to be
              real output would undo the point of the section. */}
          {item.model ? (
            <span className="text-xs text-muted-foreground">{item.model}</span>
          ) : null}
        </div>

        <p className="line-clamp-2 text-sm text-muted-foreground">
          {item.prompt}
        </p>

        {/* Carries the prompt through sign-up into the studio — the same
            contract as the homepage composer. Never a generic bounce to
            pricing, which is what these cards used to do. */}
        <Link
          href={`/sign-up?redirect_url=${encodeURIComponent(
            `/studio?prompt=${encodeURIComponent(item.prompt)}&modality=${item.kind}`,
          )}`}
          className={cn(
            "inline-flex items-center gap-1 text-sm font-medium text-primary",
            "underline-offset-4 hover:underline",
            "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
          )}
        >
          {tryLabel}
          <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
