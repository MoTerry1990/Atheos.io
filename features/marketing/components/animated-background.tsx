import { cn } from "@/lib/utils";

/**
 * The hero backdrop.
 *
 * Four layers, deliberately cheap:
 *
 *   1. aurora   two large radial gradients (a CSS token)
 *   2. orbs     three blurred blobs drifting on `transform` only
 *   3. grid     a masked technical grid
 *   4. grain    noise, to stop the gradients banding
 *
 * ## Why this is not a Client Component
 *
 * There is no state and no JavaScript. Every animation is a CSS keyframe on
 * `transform`, which the compositor runs off the main thread. That matters more
 * here than anywhere else on the page: this is on screen while React is still
 * hydrating, so anything costing main-thread time drops frames at exactly the
 * moment a visitor forms their first impression.
 *
 * It also means reduced-motion is already handled — the global
 * `prefers-reduced-motion` rule in `globals.css` zeroes CSS animation durations,
 * so the orbs simply hold still. No JS branch, no hydration mismatch.
 *
 * `aria-hidden` throughout: this is atmosphere, and a screen reader announcing
 * four empty decorative divs is pure noise.
 */
export function AnimatedBackground({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 -z-10 overflow-hidden",
        className,
      )}
    >
      {/* 1 — ambient wash */}
      <div className="absolute inset-0 bg-aurora" />

      {/* 2 — drifting orbs. Offset delays and durations so the composition
             never visibly loops. */}
      <div
        className="orb -top-40 -left-32 size-[32rem]"
        style={{
          background: "var(--color-brand-500)",
          animation: "drift 22s var(--ease-out-quart) infinite",
        }}
      />
      <div
        className="orb top-10 right-[-8rem] size-[26rem]"
        style={{
          background: "var(--color-info-500)",
          animation: "drift 28s var(--ease-out-quart) infinite",
          animationDelay: "-8s",
        }}
      />
      <div
        className="orb top-[24rem] left-[35%] size-[22rem] opacity-30"
        style={{
          background: "var(--color-brand-400)",
          animation: "drift 34s var(--ease-out-quart) infinite",
          animationDelay: "-16s",
        }}
      />

      {/* 3 — technical grid */}
      <div className="absolute inset-0 bg-grid opacity-60" />

      {/* 4 — grain. Very low opacity: if you can see it as texture rather than
             feel it as depth, it is too strong. */}
      <div className="absolute inset-0 grain opacity-[0.15] mix-blend-overlay" />

      {/* Fade into the page background so the hero has no hard bottom edge. */}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}
