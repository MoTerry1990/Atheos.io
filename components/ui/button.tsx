import { type VariantProps, cva } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Button.
 *
 * Notes on the choices here, since a button is the most-copied component in any
 * system and the defaults propagate everywhere:
 *
 * - **`active:scale-[0.98]`** on every variant. A press that produces no
 *   physical response feels broken on touch devices, where there is no hover
 *   state to confirm the target was hit.
 * - **`gradient` and `glow` variants** carry the futuristic look. They are for
 *   *the* primary action on a screen — one per view. A page of glowing buttons
 *   has no primary action at all.
 * - **`loading` disables the button and swaps in a spinner** while keeping the
 *   label. Replacing the label with a bare spinner makes the control change
 *   width mid-interaction and the layout jump.
 * - **Minimum touch target.** The `sm` and icon sizes stay at or above 32px and
 *   are paired with generous padding; anything smaller fails WCAG 2.5.8 on a
 *   phone.
 */
const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center gap-2",
    "rounded-lg text-sm font-medium whitespace-nowrap",
    "transition-all duration-150 ease-out-quart outline-none",
    "active:scale-[0.98]",
    "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2",
    "focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "aria-invalid:ring-destructive/40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    "[&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground elevation-raised hover:bg-primary/90",

        /** The signature action. Gradient plus glow — use sparingly. */
        gradient:
          "bg-gradient-brand text-white elevation-raised hover:glow-brand-sm hover:brightness-110",

        /** Emphasis without a fill: a lit outline over the page background. */
        glow: "border border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 hover:glow-brand-sm",

        destructive:
          "bg-destructive text-destructive-foreground elevation-raised hover:bg-destructive/90 focus-visible:ring-destructive/40",

        outline:
          "border border-border bg-background hover:border-border/80 hover:bg-accent hover:text-accent-foreground",

        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",

        ghost: "hover:bg-accent hover:text-accent-foreground",

        link: "text-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        xs: "h-7 gap-1 rounded-md px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 text-xs",
        default: "h-9 px-4",
        lg: "h-11 rounded-xl px-6 text-base",
        xl: "h-13 rounded-xl px-8 text-base",
        icon: "size-9",
        "icon-xs": "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-md",
        "icon-lg": "size-11 rounded-xl",
      },
      /** Full width below `sm`. The most common responsive need for a button. */
      block: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      block: false,
    },
  },
);

export interface ButtonProps
  extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Shows a spinner and disables interaction. The label stays put. */
  loading?: boolean;
  /** Announced to screen readers while loading. */
  loadingLabel?: string;
}

function Button({
  className,
  variant = "default",
  size = "default",
  block = false,
  asChild = false,
  loading = false,
  loadingLabel = "Loading",
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";

  // `asChild` renders someone else's element (usually a Link), so we must not
  // inject a spinner into it — that would give the child two children and break
  // Slot's single-child contract.
  if (asChild) {
    return (
      <Comp
        data-slot="button"
        data-variant={variant}
        className={cn(buttonVariants({ variant, size, block, className }))}
        {...props}
      >
        {children}
      </Comp>
    );
  }

  return (
    <button
      data-slot="button"
      data-variant={variant}
      data-loading={loading || undefined}
      className={cn(buttonVariants({ variant, size, block, className }))}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" aria-hidden />
          <span className="sr-only">{loadingLabel}</span>
        </>
      ) : null}
      {children}
    </button>
  );
}

export { Button, buttonVariants };
