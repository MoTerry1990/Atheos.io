import { AlertTriangle, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Empty and error states.
 *
 * These exist as components so that "what does this screen look like when there
 * is nothing here" is a decision made once, rather than skipped. On a platform
 * where generation regularly fails and every account starts empty, these are not
 * edge cases — they are the first thing most users see.
 *
 * Both take an action, because a dead end with no next step is the actual
 * failure. An empty library should offer to create something; a failed request
 * should offer to retry.
 */

export interface EmptyStateProps extends ComponentProps<"div"> {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center",
        className,
      )}
      {...props}
    >
      {Icon ? (
        <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-gradient-brand-subtle text-primary">
          <Icon className="size-6" aria-hidden strokeWidth={1.75} />
        </div>
      ) : null}

      <h3 className="text-base font-semibold text-foreground">{title}</h3>

      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-balance text-muted-foreground">
          {description}
        </p>
      ) : null}

      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps extends ComponentProps<"div"> {
  title?: string;
  description?: string;
  /** Wire this to a retry. Omit only when retrying genuinely cannot help. */
  onRetry?: () => void;
  retryLabel?: string;
  action?: ReactNode;
}

export function ErrorState({
  title = "Something went wrong",
  description = "The request didn't complete. This is usually temporary.",
  onRetry,
  retryLabel = "Try again",
  action,
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      // `role="alert"` so the failure is announced rather than silently
      // replacing the content someone was waiting for.
      role="alert"
      className={cn(
        "flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center",
        className,
      )}
      {...props}
    >
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="size-6" aria-hidden strokeWidth={1.75} />
      </div>

      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-balance text-muted-foreground">
        {description}
      </p>

      {onRetry || action ? (
        <div className="mt-6 flex items-center gap-2">
          {onRetry ? (
            <Button variant="outline" onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
