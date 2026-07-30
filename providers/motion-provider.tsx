"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * Motion configuration.
 *
 * `reducedMotion="user"` makes Motion honour `prefers-reduced-motion` globally:
 * transform and layout animations are suppressed while opacity still animates,
 * so the interface stays legible without moving.
 *
 * This has to be handled here rather than by calling `useReducedMotion()` inside
 * each component's `initial` prop. The server cannot know the user's motion
 * preference, so a component that branches on it renders one set of inline
 * styles on the server and a different set on the client — a guaranteed
 * hydration mismatch, and React does not patch style mismatches up.
 *
 * `MotionConfig` sidesteps that by applying the preference after mount, where
 * the value is actually knowable.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
