"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/ui/state";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";

/**
 * The route error boundary.
 *
 * Until Sprint 13 there was none — anywhere. Any unhandled exception in any
 * page rendered Next's default error screen: a stack trace in development, an
 * unbranded "Application error" in production, with no way back.
 *
 * ## The digest is shown, and it is not an apology
 *
 * Next replaces the message with an opaque `digest` in production, precisely so
 * an exception cannot leak a query or a connection string to a browser. That
 * digest is also the only thing that ties what the user saw to a line in our
 * logs, so it is displayed rather than hidden — "quote this" is more use to
 * somebody than "something went wrong".
 *
 * ## Recovery is `reset()`, not a reload
 *
 * `reset()` re-renders the failed segment while keeping the rest of the app
 * mounted. A full reload discards client state — an unsaved prompt, a running
 * generation the tab is polling — to fix a failure that was probably transient.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The client-side half of the record. The server already logged the real
    // exception; this correlates it with the session that hit it.
    console.error("Route error", error.digest ?? error.message);
  }, [error]);

  return (
    <Container size="md" className="py-16">
      <ErrorState
        title="Something went wrong on this page"
        description="The rest of the app is still running. Try again — if it keeps happening, the reference below will tell us where to look."
        onRetry={reset}
        retryLabel="Try again"
        action={
          <Button variant="ghost" asChild>
            <a href="/dashboard">Go to the dashboard</a>
          </Button>
        }
      />

      {error.digest ? (
        <p className="mt-6 text-center text-2xs text-muted-foreground">
          Reference <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}
    </Container>
  );
}
