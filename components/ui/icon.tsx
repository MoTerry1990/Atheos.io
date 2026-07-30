import { type VariantProps, cva } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Icon wrapper.
 *
 * Two problems this solves, both of which get worse the larger the codebase
 * gets:
 *
 * 1. **Sizing drift.** Left alone, icons get `h-4 w-4` here and `h-[18px]`
 *    there, and a toolbar ends up with three subtly different icon sizes. The
 *    `size` scale is the only sanctioned set.
 *
 * 2. **Accessibility.** A decorative icon must be hidden from screen readers,
 *    and a meaningful one must have a label. Leaving that to each call site
 *    means it is forgotten at most of them. Here, `aria-hidden` is the default
 *    and passing `label` opts into the accessible variant — so the *safe*
 *    behaviour is the one you get by doing nothing.
 */

const iconVariants = cva("shrink-0", {
  variants: {
    size: {
      xs: "size-3",
      sm: "size-4",
      md: "size-5",
      lg: "size-6",
      xl: "size-8",
    },
    tone: {
      inherit: "",
      muted: "text-muted-foreground",
      brand: "text-primary",
      success: "text-success",
      warning: "text-warning",
      danger: "text-destructive",
    },
  },
  defaultVariants: { size: "sm", tone: "inherit" },
});

export interface IconProps extends VariantProps<typeof iconVariants> {
  /** A Lucide icon component, e.g. `Sparkles`. */
  icon: LucideIcon;
  /**
   * Accessible name. Provide it only when the icon conveys meaning that is not
   * already in adjacent text — an icon-only button, or a status indicator.
   * Omit it for decoration, and the icon is hidden from assistive technology.
   */
  label?: string;
  className?: string;
}

export function Icon({
  icon: IconComponent,
  label,
  size,
  tone,
  className,
}: IconProps) {
  return (
    <IconComponent
      className={cn(iconVariants({ size, tone }), className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      // Lucide scales stroke with size by default, which makes large icons look
      // heavy and small ones look spindly. A fixed 1.75 keeps the whole set
      // optically consistent across the size scale.
      strokeWidth={1.75}
    />
  );
}

export type { LucideIcon };
