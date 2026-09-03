"use client";

import { ArrowUpRight, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Reveal,
  Section,
  SectionHeading,
} from "@/features/marketing/components/section";
import {
  GALLERY,
  type GalleryItem,
} from "@/features/marketing/gallery.generated";
import { useCopy } from "@/features/marketing/i18n";
import { cn } from "@/lib/utils";

/**
 * The portfolio — every finished creation, browsable, with its prompt.
 *
 * ## Why the whole thing is on the page
 *
 * It replaces six cards behind no filter at all. A carousel would have been
 * less work and would have hidden most of it: the number of pieces *is* the
 * claim this section makes, and a claim you have to click sideways twelve
 * times to check is not one a visitor will check. So it is a scrolling grid,
 * and everything in the manifest renders.
 *
 * ## Masonry, because the work is not one shape
 *
 * The old grid forced every card to 4:5, which cropped a 16:9 landscape into
 * a portrait and a 9:16 vertical into a letterbox — the gallery was
 * misrepresenting its own output. CSS columns keep each card at its master's
 * real aspect ratio. `break-inside-avoid` stops a card being split across a
 * column boundary.
 *
 * The trade is reading order: columns flow top-to-bottom, so the DOM order and
 * the visual order diverge in multi-column layouts. That is acceptable here
 * because the cards are peers with no sequence between them — unlike, say, a
 * list of steps.
 *
 * ## What the browser downloads, and when
 *
 * A poster at the size the card actually renders, and nothing else, until
 * somebody asks for a video:
 *
 *   1. Posters are `loading="lazy"` with explicit `width`/`height`, so an
 *      offscreen card costs nothing and an arriving one shifts nothing.
 *   2. The first row is preloaded once the section is within 600px, so the
 *      cards are painted before they are looked at rather than fading in grey.
 *   3. A video's `<source>` is not rendered until that card has been
 *      interacted with. Not "is near the viewport" — *interacted with*. Thirty
 *      cards near the viewport would otherwise be thirty clips in flight.
 *   4. Only one plays at a time, tracked in a ref shared by every card.
 *
 * The hero is the only autoplaying video on the site. Nothing here autoplays,
 * on any viewport, ever.
 *
 * ## Hover is not available on a phone
 *
 * So the same control is a real button on every card, and the play affordance
 * is drawn rather than implied — "hover to play" is not an instruction a touch
 * user can follow. Click covers touch and keyboard alike, because Enter and
 * Space fire a click. Focus deliberately does *not* start playback: it used
 * to, and it raced the click handler into leaving the video paused while the
 * button claimed otherwise. See `toggle` below.
 *
 * ## Reduced motion means posters
 *
 * No video element is created at all. The prompt and the "Try this" action are
 * the point of a card; the motion is decoration on top of them.
 */
type Filter = "all" | "image" | "video";

/** How many posters are worth preloading: the first row on the widest layout. */
const PRELOADED = 3;

export function MadeWithAtheos() {
  const copy = useCopy();
  const sectionRef = useRef<HTMLDivElement>(null);

  const [filter, setFilter] = useState<Filter>("all");
  const [motionAllowed, setMotionAllowed] = useState(false);
  const [primed, setPrimed] = useState(false);

  /**
   * The video currently playing, shared across cards.
   *
   * A ref rather than state: changing it must not re-render the section, and
   * the pause is a direct DOM call on an element another card owns.
   */
  const playing = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setMotionAllowed(!query.matches);

    const onChange = (event: MediaQueryListEvent) =>
      setMotionAllowed(!event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  /** Warm the first posters shortly before the section is reached. */
  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setPrimed(true);
      },
      { rootMargin: "600px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const claim = useCallback((video: HTMLVideoElement) => {
    if (playing.current && playing.current !== video) playing.current.pause();
    playing.current = video;
  }, []);

  const release = useCallback((video: HTMLVideoElement) => {
    if (playing.current === video) playing.current = null;
  }, []);

  const items = useMemo(
    () =>
      filter === "all" ? GALLERY : GALLERY.filter((it) => it.kind === filter),
    [filter],
  );

  const counts = useMemo(
    () => ({
      all: GALLERY.length,
      image: GALLERY.filter((it) => it.kind === "image").length,
      video: GALLERY.filter((it) => it.kind === "video").length,
    }),
    [],
  );

  const filters: { value: Filter; label: string }[] = [
    { value: "all", label: copy.made.filters.all },
    { value: "image", label: copy.made.filters.images },
    { value: "video", label: copy.made.filters.videos },
  ];

  return (
    <Section id="made">
      <SectionHeading
        eyebrow={copy.made.eyebrow}
        title={copy.made.title}
        description={copy.made.description}
      />

      {/**
       * A group of toggles, not tabs.
       *
       * `role="group"` with `aria-pressed` rather than a tablist: a tablist
       * promises arrow-key navigation between tabs and a labelled panel per
       * tab, and this is one grid that gets shorter. Announcing it as tabs
       * would describe an interaction that does not exist.
       */}
      <div
        role="group"
        aria-label={copy.made.filters.label}
        className="mt-8 flex flex-wrap items-center gap-2"
      >
        {filters.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFilter(option.value)}
            aria-pressed={filter === option.value}
            className={cn(
              "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
              filter === option.value
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
            <span className="ml-2 text-xs opacity-70">
              {counts[option.value]}
            </span>
          </button>
        ))}

        {/* Announced when the filter changes, so a screen reader user learns
            the grid got shorter without having to go and count it. */}
        <p aria-live="polite" className="sr-only">
          {copy.made.count.replace("{count}", String(items.length))}
        </p>
      </div>

      <Reveal delay={0.05} className="mt-8">
        <div
          ref={sectionRef}
          className="columns-1 gap-4 sm:columns-2 lg:columns-3 [&>*]:mb-4"
        >
          {items.map((item, index) => (
            <MediaCard
              key={item.id}
              item={item}
              motionAllowed={motionAllowed}
              eager={primed && index < PRELOADED}
              onClaim={claim}
              onRelease={release}
              playLabel={copy.made.play}
              tryLabel={copy.made.tryThis}
            />
          ))}
        </div>
      </Reveal>
    </Section>
  );
}

function MediaCard({
  item,
  motionAllowed,
  eager,
  onClaim,
  onRelease,
  playLabel,
  tryLabel,
}: {
  item: GalleryItem;
  motionAllowed: boolean;
  eager: boolean;
  onClaim: (video: HTMLVideoElement) => void;
  onRelease: (video: HTMLVideoElement) => void;
  playLabel: string;
  tryLabel: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  /**
   * Whether this card has ever been asked for its video.
   *
   * Gates the `<source>`, not the `<video>`: an element with no source
   * downloads nothing. Once armed it stays armed, so a second hover does not
   * re-request a file the browser already has.
   */
  const [armed, setArmed] = useState(false);
  const [active, setActive] = useState(false);

  const isVideo = item.kind === "video" && Boolean(item.src);
  const playable = isVideo && motionAllowed;

  /** Stop when the card leaves the viewport, whatever the pointer is doing. */
  useEffect(() => {
    const node = cardRef.current;
    if (!node || !playable) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) return;

      const video = videoRef.current;
      if (video) {
        video.pause();
        onRelease(video);
      }
      setActive(false);
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [playable, onRelease]);

  function start() {
    setArmed(true);

    const video = videoRef.current;
    if (!video) return;

    onClaim(video);
    setActive(true);
    // Rejects when the browser declines; the poster stays and nothing breaks.
    void video.play().catch(() => undefined);
  }

  /**
   * The click path, answered by the element rather than by React state.
   *
   * `active` is React's belief about playback; `video.paused` is the fact. The
   * two came apart on the built page — a card was observed paused while its
   * button reported `aria-pressed="true"` — because the viewport observer
   * pauses the element directly, without going through `stop()`. Anything that
   * reads `active` to decide what a click means inherits that staleness, so
   * this reads the element instead. The `onPlay`/`onPause` handlers below close
   * the loop from the other side.
   *
   * `onFocus={start}` and `onBlur={stop}` are gone with it. They were a second
   * way to start and stop the same video, racing the click handler on any
   * pointer interaction, and focus-to-play means tabbing through a thirty-card
   * gallery starts thirty previews. Keyboard users lose nothing: Enter and
   * Space fire a click.
   */
  function toggle() {
    const video = videoRef.current;
    if (!video) {
      // First interaction: no source yet. Arm it; the effect below plays it as
      // soon as the element exists.
      setArmed(true);
      setActive(true);
      return;
    }
    if (video.paused) start();
    else stop();
  }

  function stop() {
    const video = videoRef.current;
    if (!video) return;

    video.pause();
    video.currentTime = 0;
    onRelease(video);
    setActive(false);
  }

  /**
   * The source lands after the first interaction, so the very first hover has
   * nothing to play yet. Playing once it can is what makes one hover enough.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (armed && active && video && video.paused) {
      void video.play().catch(() => undefined);
    }
  }, [armed, active]);

  return (
    <div
      ref={cardRef}
      className="group relative break-inside-avoid overflow-hidden rounded-xl border border-border bg-card"
      onMouseEnter={playable ? start : undefined}
      onMouseLeave={playable ? stop : undefined}
    >
      {/**
       * The master's real ratio, on the container.
       *
       * The box is the right size before the poster arrives, so nothing below
       * it moves — and `bg-surface-sunken` rather than black means a card that
       * has not painted yet reads as an empty frame rather than as a broken one.
       */}
      <div
        className="relative w-full overflow-hidden bg-surface-sunken"
        style={{ aspectRatio: `${item.width} / ${item.height}` }}
      >
        <Image
          src={item.poster}
          alt={`AI generation from the prompt: ${item.prompt}`}
          width={item.width}
          height={item.height}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          quality={90}
          loading={eager ? "eager" : "lazy"}
          priority={false}
          className={cn(
            "size-full object-cover transition-opacity duration-500",
            active ? "opacity-0" : "opacity-100",
          )}
        />

        {playable ? (
          <video
            ref={videoRef}
            muted
            loop
            playsInline
            // No `autoPlay`. Playing is a decision made by hover, focus or tap.
            preload="none"
            /**
             * State follows the element, not the other way round.
             *
             * `active` drives both the crossfade and `aria-pressed`. Anything
             * that pauses the video without going through `stop()` — the
             * viewport observer, another card claiming playback, the browser
             * refusing autoplay — would otherwise leave the button claiming it
             * is playing something that has stopped.
             */
            onPlay={() => setActive(true)}
            onPause={() => setActive(false)}
            aria-hidden
            className={cn(
              "absolute inset-0 size-full object-cover transition-opacity duration-500",
              active ? "opacity-100" : "opacity-0",
            )}
          >
            {/* One source, and only once asked for. There is no WebM: on this
                material every VP9 encode came out heavier than H.264, and the
                browser takes the first source it can play — so a losing WebM
                would be the one downloaded. */}
            {armed ? <source src={item.src} type="video/mp4" /> : null}
          </video>
        ) : null}

        {playable ? (
          <button
            type="button"
            onClick={toggle}
            aria-label={`${playLabel}: ${item.prompt}`}
            aria-pressed={active}
            className={cn(
              "absolute top-3 right-3 flex size-10 items-center justify-center rounded-full",
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
        <div className="flex flex-wrap items-center gap-2">
          {/**
           * `bg-accent text-accent-foreground`, not `bg-primary/10 text-primary`.
           *
           * The old pairing measured 4.22:1 in Lighthouse — `#ad46ff` on
           * `#21152b` — against the 4.5:1 floor 11px text has to clear. The
           * accent pair is defined per theme, so this passes in both rather
           * than in whichever one happened to get tested.
           */}
          <span className="rounded-md bg-accent px-2 py-0.5 text-2xs font-medium tracking-wider text-accent-foreground uppercase">
            {item.kind}
          </span>
          {/* The subject, never the model. Which vendor produced a piece is
              not the visitor's business and is not ours to advertise. */}
          <span className="text-xs text-muted-foreground">{item.category}</span>
        </div>

        <p className="line-clamp-2 text-sm text-muted-foreground">
          {item.prompt}
        </p>

        {/* Carries the prompt through sign-up into the studio — the same
            contract as the homepage composer. Never a generic bounce to
            pricing, which is what these cards used to do. */}
        <Link
          href={`/sign-up?redirect_url=${encodeURIComponent(
            `/studio?prompt=${encodeURIComponent(item.prompt)}&modality=${item.modality}`,
          )}`}
          className={cn(
            "inline-flex items-center gap-1 text-sm font-medium text-primary",
            // The text is 22px tall. `min-h-11` with a negative inline margin
            // gives the thumb a 44px target without moving the text or adding
            // a visible box.
            "-mx-2 min-h-11 rounded-md px-2 py-2",
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
