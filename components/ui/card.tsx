import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Card.
 *
 * Four surface treatments, each with a job:
 *
 *   default    the workhorse — a bordered panel on the page background
 *   glass      frosted, for anything floating over content (overlays, toolbars)
 *   gradient   a hairline gradient border, for the one card being upsold
 *   ghost      no chrome at all, for grouping without visual weight
 *
 * `interactive` is separate from variant because *any* of them can be
 * clickable. It adds hover elevation and a lift — but only on devices that
 * actually hover, since a sticky hover state on touch is worse than none.
 */
const cardVariants = cva(
  "flex flex-col gap-6 rounded-xl py-6 text-card-foreground transition-all duration-200",
  {
    variants: {
      variant: {
        default: "border bg-card elevation-raised",
        glass: "surface-glass elevation-floating",
        gradient: "elevation-raised border-gradient",
        ghost: "border-transparent bg-transparent",
      },
      interactive: {
        true: "cursor-pointer hover:-translate-y-0.5 hover:elevation-floating focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none motion-reduce:hover:translate-y-0",
        false: "",
      },
    },
    defaultVariants: { variant: "default", interactive: false },
  },
);

export interface CardProps
  extends React.ComponentProps<"div">, VariantProps<typeof cardVariants> {}

function Card({ className, variant, interactive, ...props }: CardProps) {
  return (
    <div
      data-slot="card"
      data-variant={variant}
      className={cn(cardVariants({ variant, interactive }), className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("leading-none font-semibold", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className,
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  cardVariants,
};
