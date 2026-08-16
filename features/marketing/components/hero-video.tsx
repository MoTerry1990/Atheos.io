"use client";

import { useEffect, useRef, useState } from "react";

import {
  HERO_MEDIA,
  readCapabilities,
  shouldPlayVideo,
} from "@/features/marketing/components/hero-media";
import { cn } from "@/lib/utils";

/**
 * The hero's moving background.
 *
 * ## The clip is our own output
 *
 * An 8.2 s loop cut from a 4K master, encoded at 1280x720 / 24 fps. Sprint 4.5
 * shipped it at 1080p30 and paid 232 ms of total blocking time for the extra
 * pixels — on a surface that paints 1430x622 CSS px behind a 40% scrim, where
 * almost none of them survive to the eye. This is the same scene and the same
 * loop at roughly half the bytes.
 *
 * ## Poster first, always
 *
 * The poster is a CSS background on a sibling element, not the video's `poster`
 * attribute, so it stays painted underneath and the video cross-fades over it
 * rather than replacing it in one frame. It is also the LCP element and is
 * preloaded in `landing.tsx`; the video is decoration that arrives afterwards.
 *
 * The desktop poster is **frame 0 of the loop**, so the hand-off is a dissolve
 * between two nearly identical images. The mobile poster is a brighter frame
 * instead, because mobile never plays the video — a phone showing frame 0
 * forever would show a near-black hero forever.
 *
 * ## Nothing is decided during render
 *
 * `eligible` starts `null` and is resolved in an effect. Reading `matchMedia`,
 * `navigator.connection` or `innerWidth` while rendering would produce
 * different markup on the server than on the client, which is a hydration
 * error. Null means "not yet decided", and no video element exists until it is.
 */
export function HeroVideo({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [eligible, setEligible] = useState<boolean | null>(null);
  const [near, setNear] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  /** Decide eligibility once mounted, and re-decide if the environment changes. */
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const decide = () => setEligible(shouldPlayVideo(readCapabilities()));

    decide();
    motion.addEventListener("change", decide);
    window.addEventListener("resize", decide);
    return () => {
      motion.removeEventListener("change", decide);
      window.removeEventListener("resize", decide);
    };
  }, []);

  /**
   * Only mount sources once the hero is near the viewport.
   *
   * The hero sits at the top of the page, so in practice this is true almost
   * immediately — but "almost immediately" is after hydration and after the
   * poster has painted, which is the point. It also means a visitor who lands
   * deep-linked further down the page never downloads the loop at all.
   */
  useEffect(() => {
    const node = containerRef.current;
    if (!node || eligible !== true) return;

    const observer = new IntersectionObserver(
      (entries) => setNear(entries[0]?.isIntersecting ?? false),
      { rootMargin: "200px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [eligible]);

  /**
   * Play, pause and recover.
   *
   * A rejected `play()` is not an error — browsers refuse autoplay in low-power
   * mode and sometimes for no visible reason — but it must not leave a frozen
   * frame pretending to be a loop, so it surfaces a real control instead.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || eligible !== true || !near) return;

    let cancelled = false;

    const attempt = () => {
      void video
        .play()
        .then(() => {
          if (!cancelled) setAutoplayBlocked(false);
        })
        .catch(() => {
          if (!cancelled) setAutoplayBlocked(true);
        });
    };

    attempt();

    // A loop decoding behind another tab burns battery to render something
    // nobody is looking at.
    const onVisibility = () => {
      if (document.hidden) video.pause();
      else attempt();
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      video.pause();
    };
  }, [eligible, near]);

  /** Pause the moment the hero scrolls away, without tearing it down. */
  useEffect(() => {
    const video = videoRef.current;
    if (video && !near) video.pause();
  }, [near]);

  const showVideo = eligible === true && near;

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 -z-10", className)}
    >
      <div className="hero-poster absolute inset-0 bg-cover bg-center" />

      {showVideo ? (
        <video
          ref={videoRef}
          // All three are preconditions for autoplay being permitted at all;
          // `playsInline` additionally stops iOS taking the video fullscreen.
          muted
          loop
          playsInline
          autoPlay
          // The poster has already painted. `none` keeps the loop from
          // competing with it for bandwidth before it is needed.
          preload="none"
          onPlaying={() => setPlaying(true)}
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-1000 ease-out",
            playing ? "opacity-100" : "opacity-0",
          )}
        >
          {/* WebM first, and it is genuinely the smaller file — 1,255 KB
              against 1,656 KB. The browser takes the first source it can play
              and downloads only that one, so ordering *is* the negotiation and
              nobody fetches both. */}
          <source src={HERO_MEDIA.webm} type="video/webm" />
          <source src={HERO_MEDIA.mp4} type="video/mp4" />
        </video>
      ) : null}

      {/**
       * One scrim, not three.
       *
       * This was a flat `bg-background/70`, then a `from-background/60`
       * gradient over it, then a brand tint at 60%. Compounded, the top of the
       * frame was about 88% obscured and the hero read as a dark rectangle with
       * a headline on it. The replacement is a single vertical gradient: light
       * where the art is, heavy at the bottom where the section dissolves into
       * the page. Colour contrast scores 100 with it in place.
       */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/45 to-background" />
      <div className="absolute inset-0 bg-gradient-brand-subtle opacity-30" />

      {/**
       * The fallback control, shown only when autoplay was actually refused.
       *
       * Bottom-right and inside the hero's own stacking context, so it cannot
       * cover the headline or either CTA. `pointer-events-auto` re-enables
       * clicks that the decorative wrapper turns off, and `aria-hidden` is
       * explicitly cleared — this one element *is* for the user.
       */}
      {autoplayBlocked && showVideo ? (
        <button
          type="button"
          aria-hidden={false}
          onClick={() => {
            void videoRef.current?.play().then(() => setAutoplayBlocked(false));
          }}
          className="pointer-events-auto absolute right-4 bottom-4 rounded-full border border-border/60 bg-background/70 px-3 py-2 text-xs font-medium text-foreground backdrop-blur-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          Play animation
        </button>
      ) : null}
    </div>
  );
}
