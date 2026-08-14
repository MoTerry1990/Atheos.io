"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The moving background on the sign-in and sign-up panel.
 *
 * Same contract as `HeroVideo` and deliberately not shared with it. The two
 * differ in every constraint that matters — this one is portrait, it sits
 * beside form fields rather than under a headline, and it is darker and slower
 * because motion next to an input somebody is typing into is the kind that gets
 * a product called distracting. A shared component with four props to express
 * that would be harder to read than two short files.
 *
 * The three behaviours that are the same, and are the point:
 *
 *   - `prefers-reduced-motion` means **do not download or play it at all**, not
 *     play it gently. A drifting background is exactly the class of motion that
 *     triggers vestibular symptoms.
 *   - The fade-in is driven by `playing`, not by load. A browser that blocks
 *     autoplay shows the poster rather than a frozen frame pretending to loop.
 *   - The poster is a still from the same seed, so the panel is composed even
 *     when the video never arrives.
 */
export function AuthPanelVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    /**
     * Two gates, both required.
     *
     * The panel this sits in is `hidden lg:block` — **CSS-hidden, not
     * unmounted**. A `<video>` inside it still downloads, so on a phone this
     * was three and a half megabytes fetched for a panel the user never sees,
     * on the page where they are deciding whether to bother signing up. The
     * width check is not an optimisation, it is the difference between a fast
     * sign-up on a Peruvian mobile connection and a slow one.
     *
     * 1024px matches Tailwind's `lg`. Kept in step by hand, which is the cost
     * of the container being styled and the video being mounted by two
     * different systems.
     */
    const desktop = window.matchMedia("(min-width: 1024px)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");

    const evaluate = () => setAllowed(desktop.matches && !still.matches);
    evaluate();

    desktop.addEventListener("change", evaluate);
    still.addEventListener("change", evaluate);
    return () => {
      desktop.removeEventListener("change", evaluate);
      still.removeEventListener("change", evaluate);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !allowed) return;

    // Rejects wherever autoplay is blocked. Swallowed: there is nothing to
    // recover, and an unhandled rejection on first paint hides real errors.
    void video.play().catch(() => undefined);
  }, [allowed]);

  return (
    <>
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/marketing/auth-poster.webp)" }}
      />

      {allowed ? (
        <video
          ref={videoRef}
          muted
          loop
          playsInline
          autoPlay
          // `metadata` rather than `auto`: this is decoration on a page whose
          // job is a form, and it must not compete for bandwidth with the
          // Clerk script the sign-in button depends on.
          preload="metadata"
          onPlaying={() => setPlaying(true)}
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-1000 ease-out",
            playing ? "opacity-100" : "opacity-0",
          )}
        >
          <source src="/marketing/auth.mp4" type="video/mp4" />
        </video>
      ) : null}

      {/* Heavier than the hero's scrim. The caption below sits over the bottom
          third, and the panel is a backdrop rather than a subject. */}
      <div className="absolute inset-0 bg-background/75" />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/40" />
    </>
  );
}
