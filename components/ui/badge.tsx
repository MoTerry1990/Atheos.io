import { type VariantProps, cva } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Badge.
 *
 * Two families, and the distinction matters:
 *
 * - **Tonal** (`default`, `success`, `warning`…) — a tinted background with a
 *   matching border. Low contrast on purpose: a badge annotates content, it does
 *   not compete with it. Solid fills at badge size turn a table into confetti.
 * - **`gradient`** — the single high-emphasis option, for "Pro", "New", "Beta".
 *   One per screen.
 *
 * `dot` prepends a status indicator, which is how generation states are shown.
 * The dot is decorative: the badge's text carries the meaning, so a colour-blind
 * user loses nothing by not distinguishing amber from green.
 */
const badgeVariants = cva(
  [
    "inline-flex w-fit shrink-0 items-center justify-center gap-1.5",
    "rounded-full border font-medium whitespace-nowrap",
    "overflow-hidden transition-colors",
    "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
    "[&_svg]:pointer-events-none",
  ],
  {
    variants: {
      variant: {
        default: "border-border bg-secondary text-secondary-foreground",
        brand: "border-primary/25 bg-primary/10 text-primary",
        success: "border-success/25 bg-success/10 text-success",
        warning: "border-warning/25 bg-warning/10 text-warning",
        danger: "border-destructive/25 bg-destructive/10 text-destructive",
        info: "border-info/25 bg-info/10 text-info",
        outline: "border-border bg-transparent text-foreground",
        gradient: "border-transparent bg-gradient-brand text-white",
      },
      size: {
        sm: "px-1.5 py-0 text-2xs [&_svg]:size-2.5",
        default: "px-2 py-0.5 text-xs [&_svg]:size-3",
        lg: "px-2.5 py-1 text-sm [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

const dotTones: Record<string, string> = {
  default: "bg-muted-foreground",
  brand: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  outline: "bg-muted-foreground",
  gradient: "bg-white",
};

export interface BadgeProps
  extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {
  asChild?: boolean;
  /** Prepend a status dot. */
  dot?: boolean;
  /** Animate the dot — for states that are actively in progress. */
  pulse?: boolean;
}

function Badge({
  className,
  variant = "default",
  size,
  asChild = false,
  dot = false,
  pulse = false,
  children,
  ...props
}: BadgeProps) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    >
      {dot ? (
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            dotTones[variant ?? "default"],
            pulse && "animate-pulse",
          )}
        />
      ) : null}
      {children}
    </Comp>
  );
}

export { Badge, badgeVariants };
