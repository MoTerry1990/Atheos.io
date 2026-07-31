"use client";

import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A number that counts up when it scrolls into view.
 *
 * ## Why the DOM node holds the initial value
 *
 * The element renders the **final** number on the server and only starts from
 * zero after mount. Rendering `0` server-side would mean a crawler, a screen
 * reader reading before hydration, and a user on a slow connection all see a
 * balance of zero — which for a credits figure is not a cosmetic problem.
 *
 * ## Why `animate()` and not state
 *
 * Driving this through `useState` re-renders the component sixty times a
 * second. `animate()` writes to `textContent` directly, so the React tree is
 * untouched for the whole animation. With several counters on one dashboard
 * that is the difference between a smooth entrance and a stutter.
 *
 * Reduced motion skips the animation entirely — a rapidly changing number is
 * exactly the kind of movement the preference exists to suppress.
 */
export function Counter({
  value,
  duration = 1.1,
  format = (n: number) => Math.round(n).toLocaleString("en-US"),
  className,
}: {
  value: number;
  duration?: number;
  format?: (value: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -40px 0px" });
  const reduced = useReducedMotion();
  const [hasRun, setHasRun] = useState(false);

  useEffect(() => {
    if (!inView || hasRun || !ref.current) return;
    setHasRun(true);

    if (reduced) return; // already showing the final value

    const node = ref.current;
    const controls = animate(0, value, {
      duration,
      ease: [0.25, 1, 0.5, 1],
      onUpdate: (latest) => {
        node.textContent = format(latest);
      },
    });

    return () => controls.stop();
  }, [inView, hasRun, value, duration, format, reduced]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {format(value)}
    </span>
  );
}
