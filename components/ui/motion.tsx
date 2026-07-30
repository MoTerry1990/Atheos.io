"use client";

import { type HTMLMotionProps, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Motion primitives.
 *
 * Animation is the fastest way to make an interface feel expensive and the
 * fastest way to make it feel cheap. The difference is discipline, so this file
 * holds the whole vocabulary and components do not hand-roll transitions.
 *
 * Three rules encoded here:
 *
 * 1. **Short.** 150–400ms. Anything longer is something the user waits through
 *    on every interaction, and they interact hundreds of times a session.
 * 2. **Enter, don't exit.** Elements animate in. Exits are near-instant, because
 *    an animation the user is waiting to finish is friction.
 * 3. **Reduced motion is honoured** — globally, by `MotionProvider`.
 *
 * ## Why these components never branch on `useReducedMotion()` in `initial`
 *
 * The obvious implementation is `initial={{ y: reduced ? 0 : 12 }}`. It is
 * wrong under SSR: the server cannot know the user's motion preference, so it
 * renders one set of inline styles and the client renders another. React
 * reports a hydration mismatch and — critically — does **not** patch style
 * mismatches up, so the element can be left stuck at `opacity: 0`.
 *
 * Instead `<MotionConfig reducedMotion="user">` in `providers/motion-provider`
 * suppresses transforms globally, after mount, where the preference is
 * knowable. Opacity still animates, which keeps the interface legible without
 * moving anything.
 *
 * `useReducedMotion()` is still fine for things that never touch the initial
 * render — hover and tap responses, stagger timing — and is used that way below.
 */

/** Durations in seconds, mirroring the CSS duration tokens. */
export const duration = {
  instant: 0.08,
  fast: 0.15,
  normal: 0.24,
  slow: 0.4,
} as const;

/** Matches `--ease-out-quart` and `--ease-spring` in the stylesheet. */
export const easing = {
  out: [0.25, 1, 0.5, 1],
  in: [0.5, 0, 0.75, 1],
  spring: [0.34, 1.56, 0.64, 1],
} as const;

export interface MotionWrapperProps extends HTMLMotionProps<"div"> {
  children: ReactNode;
  /** Seconds. For deliberate sequencing — to stagger a list, use `Stagger`. */
  delay?: number;
  className?: string;
}

/** Fade and rise. The default entrance for cards, panels and sections. */
export function FadeIn({
  children,
  delay = 0,
  className,
  ...props
}: MotionWrapperProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.slow, ease: easing.out, delay }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Fade and scale. For things that appear in place: popovers, result tiles. */
export function ScaleIn({
  children,
  delay = 0,
  className,
  ...props
}: MotionWrapperProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: duration.normal, ease: easing.spring, delay }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/**
 * Staggered container. Children marked with `StaggerItem` arrive in sequence.
 *
 * Keep `stagger` small. At 0.1s a twelve-item grid takes over a second to finish
 * arriving, and the last tile reads as a bug rather than as polish.
 *
 * Reading the motion preference here is safe: `staggerChildren` affects timing
 * only and never appears in the server-rendered markup.
 */
export function Stagger({
  children,
  stagger = 0.04,
  className,
  ...props
}: MotionWrapperProps & { stagger?: number }) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: reduced ? 0 : stagger } },
      }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
  ...props
}: MotionWrapperProps) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 10 },
        visible: { opacity: 1, y: 0 },
      }}
      transition={{ duration: duration.normal, ease: easing.out }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/**
 * Reveals on scroll. `once` is true by default — re-animating on every scroll
 * past turns a long page into a flickering mess.
 */
export function RevealOnScroll({
  children,
  delay = 0,
  className,
  ...props
}: MotionWrapperProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      // The negative bottom margin fires the animation slightly before the
      // element reaches the fold, so it has settled by the time it arrives.
      viewport={{ once: true, margin: "0px 0px -80px 0px" }}
      transition={{ duration: duration.slow, ease: easing.out, delay }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/**
 * Press feedback for custom interactive surfaces.
 *
 * Buttons already do this in CSS; this is for things that are clickable but are
 * not buttons — asset tiles, selectable cards. `whileHover`/`whileTap` never
 * touch the initial render, so reading the preference here is safe.
 */
export function Pressable({
  children,
  className,
  ...props
}: MotionWrapperProps) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      whileTap={reduced ? undefined : { scale: 0.98 }}
      whileHover={reduced ? undefined : { y: -2 }}
      transition={{ duration: duration.fast, ease: easing.out }}
      className={cn("cursor-pointer", className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export { motion, useReducedMotion };
