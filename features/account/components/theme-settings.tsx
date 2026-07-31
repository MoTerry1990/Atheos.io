"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Theme preference.
 *
 * Three options, not a toggle. "Follow the system" is a real preference — a
 * switch has nowhere to put it and silently discards it the first time it is
 * used.
 *
 * ## The mounted guard
 *
 * The server cannot know which theme the browser resolved, so rendering the
 * selected state before hydration is a guaranteed mismatch. A skeleton of the
 * same dimensions holds the space, so the panel does not jump when the real
 * control arrives.
 *
 * ## Where this is stored
 *
 * `next-themes` writes to `localStorage`, which means the preference is
 * per-device. That is arguably correct — someone may want dark on a laptop at
 * night and light on a desktop by a window — and it is certainly better than
 * the alternative available today, which is a round trip to the server before
 * the first paint. If it should follow the account instead, it moves into the
 * same metadata store the notification preferences use.
 *
 * Previews are rendered as miniature UI rather than colour swatches: people
 * choose a theme by recognising it, not by evaluating a hex value.
 */

const OPTIONS = [
  {
    value: "light",
    label: "Light",
    icon: Sun,
    description: "Bright surfaces",
    preview: { page: "#ffffff", panel: "#f4f4f5", text: "#18181b" },
  },
  {
    value: "dark",
    label: "Dark",
    icon: Moon,
    description: "Default — easier on long sessions",
    preview: { page: "#0a0a0b", panel: "#1c1c1f", text: "#fafafa" },
  },
  {
    value: "system",
    label: "System",
    icon: Monitor,
    description: "Follow your device",
    preview: { page: "#0a0a0b", panel: "#ffffff", text: "#a1a1aa" },
  },
] as const;

export function ThemeSettings() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map((option) => (
          <Skeleton key={option.value} className="h-36 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="grid gap-3 sm:grid-cols-3"
    >
      {OPTIONS.map((option) => {
        const selected = theme === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(option.value)}
            className={cn(
              "group relative rounded-xl border p-3 text-left transition-all",
              "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
              selected
                ? "border-primary bg-primary/5"
                : "border-border hover:border-border/80 hover:bg-accent/40",
            )}
          >
            {/* Miniature interface, not a swatch. */}
            <div
              aria-hidden
              className="mb-3 h-16 overflow-hidden rounded-lg border border-border"
              style={{ backgroundColor: option.preview.page }}
            >
              <div
                className="m-2 h-3 w-1/2 rounded-sm"
                style={{ backgroundColor: option.preview.text, opacity: 0.8 }}
              />
              <div
                className="mx-2 h-7 rounded-sm"
                style={{ backgroundColor: option.preview.panel }}
              />
            </div>

            <div className="flex items-center gap-2">
              <option.icon
                className="size-4 shrink-0"
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="text-sm font-medium">{option.label}</span>
              {selected ? (
                <Check
                  className="ml-auto size-4 text-primary"
                  strokeWidth={2.5}
                  aria-hidden
                />
              ) : null}
            </div>

            <p className="mt-1 text-xs text-muted-foreground">
              {option.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}
