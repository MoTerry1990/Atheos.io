import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/utils";

const widths = {
  sm: "max-w-3xl",
  md: "max-w-5xl",
  lg: "max-w-7xl",
  xl: "max-w-[96rem]",
  full: "max-w-none",
} as const;

export interface ContainerProps {
  children: ReactNode;
  className?: string;
  /** Maximum content width. Defaults to `lg`. */
  size?: keyof typeof widths;
  /** Render as a different element — `section`, `main`, `header`. */
  as?: ElementType;
}

/**
 * Horizontal rhythm.
 *
 * Every page-level surface goes through this rather than repeating
 * `mx-auto max-w-7xl px-4 sm:px-6 lg:px-8`. When the gutter changes — and it
 * will — it changes once, and nothing drifts out of alignment with everything
 * else.
 */
export function Container({
  children,
  className,
  size = "lg",
  as: Component = "div",
}: ContainerProps) {
  return (
    <Component
      className={cn(
        "mx-auto w-full px-4 sm:px-6 lg:px-8",
        widths[size],
        className,
      )}
    >
      {children}
    </Component>
  );
}
