import { type VariantProps, cva } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ElementType } from "react";

import { cn } from "@/lib/utils";

/**
 * Spacing primitives.
 *
 * Layout spacing is applied by a **parent**, never by a child. A component that
 * sets its own `mb-4` decides the spacing of every context it is ever dropped
 * into, and the result is a codebase where half the margins are cancelled by
 * `last:mb-0` hacks. These components own the gaps so components never have to.
 *
 * The `gap` scale is deliberately short. Seven options is enough to build
 * anything and few enough that two engineers pick the same one.
 */

const gaps = {
  none: "gap-0",
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
  xl: "gap-8",
  "2xl": "gap-12",
} as const;

const stackVariants = cva("flex flex-col", {
  variants: {
    gap: gaps,
    align: {
      start: "items-start",
      center: "items-center",
      end: "items-end",
      stretch: "items-stretch",
    },
  },
  defaultVariants: { gap: "md", align: "stretch" },
});

export interface StackProps
  extends ComponentPropsWithoutRef<"div">, VariantProps<typeof stackVariants> {
  as?: ElementType;
}

/** Vertical rhythm. */
export function Stack({
  as: Component = "div",
  gap,
  align,
  className,
  ...props
}: StackProps) {
  return (
    <Component
      className={cn(stackVariants({ gap, align }), className)}
      {...props}
    />
  );
}

const inlineVariants = cva("flex flex-row", {
  variants: {
    gap: gaps,
    align: {
      start: "items-start",
      center: "items-center",
      end: "items-end",
      baseline: "items-baseline",
    },
    justify: {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
      between: "justify-between",
    },
    wrap: {
      // Wrapping is the default. A toolbar that refuses to wrap is a toolbar
      // that overflows the viewport on a phone.
      true: "flex-wrap",
      false: "flex-nowrap",
    },
  },
  defaultVariants: {
    gap: "sm",
    align: "center",
    justify: "start",
    wrap: true,
  },
});

export interface InlineProps
  extends ComponentPropsWithoutRef<"div">, VariantProps<typeof inlineVariants> {
  as?: ElementType;
}

/** Horizontal rhythm. */
export function Inline({
  as: Component = "div",
  gap,
  align,
  justify,
  wrap,
  className,
  ...props
}: InlineProps) {
  return (
    <Component
      className={cn(inlineVariants({ gap, align, justify, wrap }), className)}
      {...props}
    />
  );
}

const gridVariants = cva("grid", {
  variants: {
    gap: gaps,
    /**
     * Column counts are expressed as the *final* count; the classes ramp up
     * through the breakpoints so a grid is responsive without every call site
     * repeating the same `sm: md: lg:` incantation.
     */
    cols: {
      1: "grid-cols-1",
      2: "grid-cols-1 sm:grid-cols-2",
      3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
      4: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
      6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
    },
  },
  defaultVariants: { gap: "md", cols: 3 },
});

export interface GridProps
  extends ComponentPropsWithoutRef<"div">, VariantProps<typeof gridVariants> {
  as?: ElementType;
}

export function Grid({
  as: Component = "div",
  gap,
  cols,
  className,
  ...props
}: GridProps) {
  return (
    <Component
      className={cn(gridVariants({ gap, cols }), className)}
      {...props}
    />
  );
}

/**
 * Pushes siblings apart in a flex row. Named rather than repeating
 * `<div className="flex-1" />`, which reads like a mistake at the call site.
 */
export function Spacer({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return <div aria-hidden className={cn("flex-1", className)} {...props} />;
}

/**
 * Horizontal rule that fades at both ends. Softer than a full-width border,
 * which is the difference between separating sections and drawing a line
 * through the page.
 */
export function Divider({
  className,
  ...props
}: ComponentPropsWithoutRef<"hr">) {
  return <hr className={cn("my-6 rule-fade", className)} {...props} />;
}
