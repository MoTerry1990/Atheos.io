import { type VariantProps, cva } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Loading states.
 *
 * Which one to reach for, because picking wrong is the single most common way an
 * interface feels slow:
 *
 * | Situation                              | Use             |
 * |----------------------------------------|-----------------|
 * | Shape of the result is known           | `Skeleton`      |
 * | Shape unknown, under ~1s               | `Spinner`       |
 * | Blocking an area the user can still see| `LoadingOverlay`|
 * | Work with a known total                | `ProgressBar`   |
 * | Work with no knowable total            | `ProgressBar` indeterminate |
 *
 * A skeleton beats a spinner whenever the layout is predictable: it shows the
 * page arriving rather than the page waiting. Reserve spinners for the cases
 * where you genuinely cannot know what is coming back.
 */

const spinnerVariants = cva("animate-spin", {
  variants: {
    size: {
      xs: "size-3",
      sm: "size-4",
      md: "size-6",
      lg: "size-8",
      xl: "size-12",
    },
    tone: {
      default: "text-foreground",
      muted: "text-muted-foreground",
      brand: "text-primary",
    },
  },
  defaultVariants: { size: "md", tone: "muted" },
});

export interface SpinnerProps
  extends
    Omit<ComponentProps<"svg">, "ref">,
    VariantProps<typeof spinnerVariants> {
  /** Announced to assistive technology. */
  label?: string;
}

export function Spinner({
  size,
  tone,
  className,
  label = "Loading",
  ...props
}: SpinnerProps) {
  return (
    <>
      <Loader2
        className={cn(spinnerVariants({ size, tone }), className)}
        aria-hidden
        {...props}
      />
      <span className="sr-only">{label}</span>
    </>
  );
}

/**
 * Blocks a region while keeping its content visible underneath.
 *
 * `aria-busy` on the wrapper is what tells a screen reader the region is
 * updating; the blur alone communicates nothing to someone not looking at it.
 */
export function LoadingOverlay({
  loading,
  label = "Loading",
  className,
  children,
  ...props
}: ComponentProps<"div"> & { loading: boolean; label?: string }) {
  return (
    <div
      className={cn("relative", className)}
      aria-busy={loading || undefined}
      {...props}
    >
      {children}
      {loading ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-background/60 backdrop-blur-sm">
          <Spinner size="md" tone="brand" label={label} />
        </div>
      ) : null}
    </div>
  );
}

export interface ProgressBarProps extends ComponentProps<"div"> {
  /** 0–100. Omit for an indeterminate bar. */
  value?: number;
  label?: string;
  size?: "sm" | "default";
}

/**
 * Progress.
 *
 * The indeterminate variant matters more than it looks: video generation
 * reports nothing useful for minutes, and a determinate bar frozen at 0% reads
 * as a hung process. A bar that is honestly indeterminate is better than one
 * that lies about progress.
 */
export function ProgressBar({
  value,
  label,
  size = "default",
  className,
  ...props
}: ProgressBarProps) {
  const indeterminate = value === undefined;
  const clamped = indeterminate ? 0 : Math.min(100, Math.max(0, value));

  return (
    <div
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "Progress"}
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-muted",
        size === "sm" ? "h-1" : "h-2",
        className,
      )}
      {...props}
    >
      {indeterminate ? (
        <div className="absolute inset-y-0 w-1/2 animate-indeterminate rounded-full bg-gradient-brand" />
      ) : (
        <div
          className="h-full rounded-full bg-gradient-brand transition-[width] duration-500 ease-out-quart"
          style={{ width: `${clamped}%` }}
        />
      )}
    </div>
  );
}

/**
 * Full-region loading state with a message. For route-level `loading.tsx`
 * files, where there is nothing on screen yet to skeleton.
 */
export function LoadingState({
  message = "Loading",
  className,
  ...props
}: ComponentProps<"div"> & { message?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-64 flex-col items-center justify-center gap-3 py-12 text-center",
        className,
      )}
      {...props}
    >
      <Spinner size="lg" tone="brand" label={message} />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
