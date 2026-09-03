"use client";

import Link from "next/link";
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
/** Shared chrome for the hero's own controls. Small, legible, never over the CTA. */
const CONTROL =
  "rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-xs font-medium text-foreground backdrop-blur-sm transition-colors hover:bg-background/85 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none";

export function HeroVideo({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [eligible, setEligible] = useState<boolean | null>(null);
  const [near, setNear] = useState(false);
  const [playing, setPlaying] = useState(false);

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
      /**
       * The rejection is swallowed on purpose.
       *
       * A refused autoplay is an ordinary outcome — a browser policy, not an
       * error — and there is nothing to record: the Pause/Play control is
       * always on screen now, and the `play`/`pause` listeners keep its label
       * correct whatever the browser decided. What must not happen is an
       * unhandled rejection in the console of every visitor whose browser
       * blocks it.
       */
      void video.play().catch(() => {
        if (cancelled) return;
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

  /**
   * Follow the element rather than assume the last click won.
   *
   * The video is paused by the observer when it scrolls away and by the
   * browser when the tab is hidden, neither of which goes through the button.
   * Without these the control would offer "Pause" for something already
   * stopped. Muting on the way out is what stops sound following somebody to
   * another tab after they turned it on.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const sync = () => {
      setPaused(video.paused);
      setMuted(video.muted);
    };
    const onHidden = () => {
      if (document.hidden) {
        video.pause();
        video.muted = true;
      }
      sync();
    };

    video.addEventListener("play", sync);
    video.addEventListener("pause", sync);
    video.addEventListener("volumechange", sync);
    document.addEventListener("visibilitychange", onHidden);

    return () => {
      video.removeEventListener("play", sync);
      video.removeEventListener("pause", sync);
      video.removeEventListener("volumechange", sync);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [eligible, near]);

  /**
   * Muted and paused are tracked here rather than read off the element.
   *
   * A `<video>`'s own `muted` and `paused` are not React state, so the label
   * on a button that reads them would not re-render when they change — the
   * control would say "Hear audio" after the sound was already on.
   */
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);

  const showVideo = eligible === true && near;

  return (
    <>
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
            {/* One source. The previous hero shipped WebM first because it was
              genuinely smaller; on this clip every VP9 encode came out heavier
              than H.264, and the browser takes the first source it can play —
              so a losing WebM would be the one downloaded. See
              `hero-media.ts`. */}
            <source src={HERO_MEDIA.mp4} type="video/mp4" />
          </video>
        ) : null}

        {/**
         * One scrim, and it has no colour in it.
         *
         * This was a `from-background/40` wash *plus* a violet-to-blue brand
         * tint at 30%, with `AnimatedBackground`'s violet and cyan radials
         * painted over both. The footage is a red car on a blue sea; it
         * arrived on the page mauve on one side and cyan on the other, which
         * is a strange thing for a page whose job is to show what the models
         * actually produce.
         *
         * `.hero-scrim` is pure black at varying alpha — transparent across
         * the sky, weighted where the headline and buttons sit, resolving to
         * the page background at the very bottom so the section still
         * dissolves into what follows. The rule and the reasoning are in
         * `styles/globals.css`.
         */}
        <div className="hero-scrim absolute inset-0" />
      </div>

      {/**
       * The controls, and the disclosure.
       *
       * ## Why this row is a sibling of the decoration, not a child of it
       *
       * It used to be a child, carrying `aria-hidden={false}` and a comment
       * saying the wrapper's `aria-hidden` was "explicitly cleared". It is not:
       * `aria-hidden` on an ancestor removes the whole subtree from the
       * accessibility tree and a descendant cannot opt back in. So the
       * disclosure and both controls were visible and completely unannounced —
       * and Testing Library's `getByRole` could not find them either, which is
       * how it was caught.
       *
       * Positioned against the same containing block, so it still sits
       * bottom-right of the hero and still cannot cover the headline or either
       * CTA. It is not inside the `-z-10` layer, so it needs no
       * `pointer-events-auto` to be clickable.
       *
       * ## What is conditional and what is not
       *
       * The *controls* appear only when a video is actually running: with
       * reduced motion, Save-Data, a slow connection or a phone there is no
       * video, and a Pause button over a still image is a lie.
       *
       * The *disclosure* is unconditional, and used to be conditional. Found
       * on the deployed page: `showVideo` starts false so the server and client
       * markup agree, so the server-rendered HTML carried no label at all — and
       * every visitor who never reaches the video branch saw a generated still
       * with nothing saying so. The poster is a frame of the same generated
       * clip; it needs the same disclosure.
       */}
      <div className="absolute right-4 bottom-4 flex flex-wrap items-center justify-end gap-2">
        {/**
         * The disclosure the transcode could not carry.
         *
         * The master's C2PA manifest does not survive re-encoding, so the
         * claim moves from the metadata to the page. Deliberately short: a
         * long warning over a hero reads as an apology. The noun follows what
         * is actually on screen, because calling a still a video is the small
         * inaccuracy that makes the rest of the sentence worth doubting.
         */}
        <span className="rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-2xs text-muted-foreground backdrop-blur-sm">
          AI-generated {showVideo ? "video" : "image"} · Web-optimized preview{" "}
          <Link
            href="/content-details"
            className="underline underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            Content details
          </Link>
        </span>

        {showVideo ? (
          <>
            <button
              type="button"
              onClick={() => {
                const video = videoRef.current;
                if (!video) return;
                if (video.paused) {
                  void video.play();
                } else {
                  video.pause();
                  setPlaying(false);
                }
              }}
              aria-label={
                paused ? "Play background video" : "Pause background video"
              }
              className={CONTROL}
            >
              {paused ? "Play" : "Pause"}
            </button>

            {/**
             * Muted at all times until this is pressed.
             *
             * Browsers will not autoplay with sound and should not — but the
             * clip has a real AAC track, so there is something to offer. The
             * accessible name carries the *state*, not just the action, because
             * "Hear audio" alone never tells a screen-reader user whether sound
             * is currently on.
             */}
            <button
              type="button"
              onClick={() => {
                const video = videoRef.current;
                if (!video) return;
                const next = !video.muted;
                video.muted = next;
                setMuted(next);
                if (!next && video.paused) void video.play();
              }}
              aria-pressed={!muted}
              aria-label={
                muted
                  ? "Hear audio — currently muted"
                  : "Mute audio — currently on"
              }
              className={CONTROL}
            >
              {muted ? "Hear audio" : "Mute"}
            </button>
          </>
        ) : null}
      </div>
    </>
  );
}
