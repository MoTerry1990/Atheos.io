"use client";

import { FolderPlus, ImageIcon, Music, Upload, Video } from "lucide-react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

/**
 * Quick actions.
 *
 * The five things someone opens the dashboard to do. Ordered by expected
 * frequency, not by modality symmetry — image generation is the overwhelming
 * majority of use, so it is first and visually heavier.
 *
 * ## The hover treatment
 *
 * A gradient wash fades in behind the icon, and the card lifts 2px. Both are
 * suppressed under `motion-reduce`, and neither fires on touch — a hover state
 * that sticks after a tap is worse than no hover state at all.
 *
 * ## Why these are links, not buttons
 *
 * They navigate. A `<button>` that calls `router.push` breaks middle-click,
 * cmd-click, "open in new tab" and the browser's own link preview — all things
 * people use constantly and notice immediately when they stop working.
 *
 * Targets land in Sprint 5; they point at `/dashboard` until then rather than
 * at a 404.
 */

interface QuickAction {
  href: string;
  label: string;
  hint: string;
  icon: typeof ImageIcon;
  /** The one visually heavier action. Exactly one, by convention. */
  primary?: boolean;
}

const ACTIONS: QuickAction[] = [
  {
    href: "/dashboard",
    label: "Generate image",
    hint: "From a prompt or reference",
    icon: ImageIcon,
    primary: true,
  },
  {
    href: "/dashboard",
    label: "Generate video",
    hint: "Up to 10s",
    icon: Video,
  },
  {
    href: "/dashboard",
    label: "Generate audio",
    hint: "Voice or music",
    icon: Music,
  },
  {
    href: "/dashboard",
    label: "Upload assets",
    hint: "Bring your own",
    icon: Upload,
  },
  {
    href: "/dashboard",
    label: "New project",
    hint: "Group your work",
    icon: FolderPlus,
  },
];

export function QuickActions() {
  const reduced = useReducedMotion();

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {ACTIONS.map((action, index) => (
        <motion.div
          key={action.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.35,
            ease: [0.25, 1, 0.5, 1],
            delay: index * 0.04,
          }}
          whileHover={reduced ? undefined : { y: -2 }}
        >
          <Link
            href={action.href}
            className={cn(
              "group relative flex h-full flex-col gap-3 overflow-hidden rounded-xl border p-4",
              "transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
              "hover:border-primary/30",
              action.primary
                ? "border-primary/30 bg-gradient-brand-subtle"
                : "border-border bg-card",
            )}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-brand-subtle opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            />

            <span
              className={cn(
                "relative flex size-9 items-center justify-center rounded-lg transition-colors",
                action.primary
                  ? "bg-primary text-primary-foreground"
                  : "bg-primary/10 text-primary",
              )}
            >
              <action.icon
                className="size-4.5"
                strokeWidth={1.75}
                aria-hidden
              />
            </span>

            <span className="relative">
              <span className="block text-sm font-medium">{action.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {action.hint}
              </span>
            </span>
          </Link>
        </motion.div>
      ))}
    </div>
  );
}
