"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The server's price for the current settings, and nothing older.
 *
 * ## Why this is asynchronous now
 *
 * The Studio used to price a sequence in the browser, from a table that shipped
 * beside the model capabilities. That table was a second source of truth for
 * money and it had already drifted — quoting Cinematic Fast at 288 credits
 * while the registry charged 360. The price a customer reads and the price the
 * ledger takes have to be the same number, which means one of them has to
 * travel.
 *
 * ## The three ways an async price goes wrong
 *
 * **A stale price outliving its settings.** Someone switches from Motion 1 to
 * Cinematic and, for a moment, sees Motion 1's total against Cinematic's name.
 * So a settings change invalidates immediately — before the request is even
 * sent — rather than when the reply lands.
 *
 * **Replies arriving out of order.** Type "a", then "ab"; the first request is
 * slower and answers last, and the interface settles on the wrong figure. Each
 * request carries a sequence number and anything but the newest is dropped on
 * arrival, in addition to being aborted.
 *
 * **A failure falling back to the last known price.** That is the stale-price
 * bug wearing a helpful face: the number is wrong and looks deliberate. A
 * failed quote shows a failure.
 */

export interface SequenceQuoteView {
  creditCost: number;
  providerCalls: number;
  generatedSeconds: number;
  assembledDurationSeconds: number;
  exportResolution: string;
  frameRate: number;
  blockers: readonly string[];
  mode: string;
  clipDurationsSeconds: readonly number[];
  modelId: string;
}

export type QuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; quote: SequenceQuoteView; token: string }
  | { status: "error" };

export interface SequenceQuoteInput {
  publicModelId: string;
  mode: string;
  prompt: string;
  durationSeconds: number;
  outputs?: number;
  hasReferenceImage?: boolean;
  requestedResolution?: string;
}

/** Long enough to skip per-keystroke requests, short enough not to feel laggy. */
const DEBOUNCE_MS = 350;

export function useSequenceQuote(input: SequenceQuoteInput | null): QuoteState {
  const [state, setState] = useState<QuoteState>({ status: "idle" });

  /**
   * Monotonic request id.
   *
   * `AbortController` stops a request that is still in flight; it does nothing
   * about one that already resolved and is queued behind a render. The counter
   * is what makes a late reply harmless.
   */
  const latest = useRef(0);

  // Serialised so the effect re-runs on any settings change without needing
  // every field in the dependency array — and without re-running when the
  // caller rebuilds an identical object.
  const key = input ? JSON.stringify(input) : null;

  useEffect(() => {
    if (!key) {
      setState({ status: "idle" });
      return;
    }

    const id = ++latest.current;
    const controller = new AbortController();

    // Invalidated *now*, not when the reply lands. Generate is disabled from
    // this moment, so nothing can be submitted against the previous price.
    setState({ status: "loading" });

    const timer = setTimeout(() => {
      const body = JSON.parse(key) as SequenceQuoteInput;

      fetch("/api/creative/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          kind: "sequence",
          modality: "video",
          prompt: body.prompt,
          modelId: body.publicModelId,
          mode: body.mode,
          durationSeconds: body.durationSeconds,
          outputs: body.outputs,
          resolution: body.requestedResolution,
        }),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          // A reply for settings the user has already moved past.
          if (id !== latest.current) return;

          if (!payload?.ok || !payload.quote) {
            setState({ status: "error" });
            return;
          }
          setState({
            status: "ready",
            quote: payload.quote as SequenceQuoteView,
            token: payload.token as string,
          });
        })
        .catch(() => {
          if (id !== latest.current) return;
          // No fallback to the last good price: a wrong number that looks
          // deliberate is worse than an honest failure.
          setState({ status: "error" });
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  return state;
}

/** What the Generate button should say, given the quote state. */
export function quoteLabel(state: QuoteState): string {
  switch (state.status) {
    case "idle":
      return "Generate";
    case "loading":
      return "Calculating quote…";
    case "error":
      return "Quote unavailable — Try again";
    case "ready":
      return `Generate · ${state.quote.creditCost} credits`;
  }
}

/** Generate is only ever enabled against a price the server just gave us. */
export function canGenerate(state: QuoteState): boolean {
  return state.status === "ready" && state.quote.blockers.length === 0;
}
