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
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setAllowed(!query.matches);

    const onChange = (event: MediaQueryListEvent) => setAllowed(!event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
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
