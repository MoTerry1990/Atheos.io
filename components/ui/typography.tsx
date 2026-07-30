import { type VariantProps, cva } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ElementType } from "react";

import { cn } from "@/lib/utils";

/**
 * Typography.
 *
 * The point of these components is that **size and semantics are separate
 * decisions**. A page's second-level heading is an `<h2>` for the document
 * outline and for screen readers, but it is not always `text-2xl` — that is a
 * visual choice. Coupling them forces designers to misuse heading levels to get
 * the size they want, which quietly wrecks accessibility.
 *
 * So: `as` picks the element, `size` picks the appearance.
 */

const headingVariants = cva("font-semibold text-balance text-foreground", {
  variants: {
    size: {
      display: "text-4xl tracking-tighter sm:text-5xl lg:text-6xl",
      h1: "text-3xl tracking-tight sm:text-4xl",
      h2: "text-2xl tracking-tight sm:text-3xl",
      h3: "text-xl tracking-tight sm:text-2xl",
      h4: "text-lg tracking-tight",
      h5: "text-base",
      h6: "text-sm font-medium",
    },
    gradient: {
      true: "text-gradient-brand",
      false: "",
    },
  },
  defaultVariants: { size: "h2", gradient: false },
});

export interface HeadingProps
  extends
    Omit<ComponentPropsWithoutRef<"h2">, "color">,
    VariantProps<typeof headingVariants> {
  as?: Extract<ElementType, "h1" | "h2" | "h3" | "h4" | "h5" | "h6">;
}

export function Heading({
  as: Component = "h2",
  size,
  gradient,
  className,
  ...props
}: HeadingProps) {
  return (
    <Component
      className={cn(headingVariants({ size, gradient }), className)}
      {...props}
    />
  );
}

const textVariants = cva("", {
  variants: {
    size: {
      xs: "text-xs",
      sm: "text-sm",
      base: "text-base",
      lg: "text-lg",
    },
    tone: {
      default: "text-foreground",
      muted: "text-muted-foreground",
      // Semantic tones exist so that "this text means something is wrong" is
      // expressed once, not as a colour class chosen per call site.
      success: "text-success",
      warning: "text-warning",
      danger: "text-destructive",
      brand: "text-primary",
    },
    weight: {
      normal: "font-normal",
      medium: "font-medium",
      semibold: "font-semibold",
    },
    mono: {
      true: "font-mono",
      false: "",
    },
  },
  defaultVariants: {
    size: "base",
    tone: "default",
    weight: "normal",
    mono: false,
  },
});

export interface TextProps
  extends
    Omit<ComponentPropsWithoutRef<"p">, "color">,
    VariantProps<typeof textVariants> {
  as?: Extract<ElementType, "p" | "span" | "div" | "label" | "figcaption">;
}

export function Text({
  as = "p",
  size,
  tone,
  weight,
  mono,
  className,
  ...props
}: TextProps) {
  // `label` and `figcaption` carry element-specific handler types that do not
  // unify with `p`. The props we accept are the common HTML surface, so the
  // widening is safe and keeps the `as` list useful.
  const Component = as as ElementType;

  return (
    <Component
      className={cn(textVariants({ size, tone, weight, mono }), className)}
      {...props}
    />
  );
}

/**
 * Small uppercase label for section headers and metadata rows.
 *
 * Uppercase text needs extra letter-spacing to stay legible — the shapes that
 * normally distinguish words disappear when every glyph is the same height.
 */
export function Eyebrow({
  className,
  ...props
}: ComponentPropsWithoutRef<"p">) {
  return (
    <p
      className={cn(
        "text-2xs font-medium tracking-wider text-muted-foreground uppercase",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Inline code. `break-words` because identifiers and object keys are long and
 * would otherwise force the whole page to scroll sideways on a phone.
 */
export function Code({
  className,
  ...props
}: ComponentPropsWithoutRef<"code">) {
  return (
    <code
      className={cn(
        "rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.85em] break-words text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** Long-form prose: articles, changelogs, generated descriptions. */
export function Prose({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "max-w-prose space-y-4 text-base leading-relaxed",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
        "[&_strong]:font-semibold [&_strong]:text-foreground",
        "[&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5",
        "[&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5",
        className,
      )}
      {...props}
    />
  );
}
