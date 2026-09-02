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

/**
 * What kind of number is on screen, if any.
 *
 * Named rather than inferred, because "is this figure binding?" is the
 * question the button, the label and the screen reader all need to answer, and
 * three components deriving it separately is three chances to disagree.
 *
 *   `estimate`     a local comparison figure. Must be labelled as such and
 *                  must never enable Generate.
 *   `loading`      a server quote is in flight. Any previous exact figure is
 *                  already void; an estimate may remain if it says it is one.
 *   `exact`        the server priced these exact settings and has not expired.
 *                  The only state that may be called a quote and the only one
 *                  that enables Generate.
 *   `unavailable`  no figure may be shown. Not "show the last one" — a stale
 *                  price that looks deliberate is worse than none.
 */
export type QuoteStatus = "estimate" | "loading" | "exact" | "unavailable";

export type QuoteState =
  | { status: "estimate"; estimateCredits: number }
  | { status: "loading"; estimateCredits?: number }
  | {
      status: "exact";
      quote: SequenceQuoteView;
      token: string;
      expiresAtMs: number;
      /**
       * The settings this quote was issued for, serialised.
       *
       * Carried so "is this quote for what is on screen?" is answerable from
       * the state alone rather than from the hook's private bookkeeping. The
       * hook already resets to `loading` on a settings change, so in practice
       * the two agree — but a consumer holding a state across a render, or a
       * future caller that keeps one, has no way to check without this.
       */
      fingerprint: string;
    }
  | { status: "unavailable" };

/**
 * The fingerprint for a set of settings.
 *
 * The whole input object, so anything a customer can change — model, mode,
 * duration, outputs, prompt, reference, resolution — changes it. Adding a
 * field to `SequenceQuoteInput` therefore invalidates quotes automatically
 * rather than needing to be remembered here.
 */
export function fingerprintOf(input: SequenceQuoteInput | null): string {
  return input ? JSON.stringify(input) : "";
}

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

export function useSequenceQuote(
  input: SequenceQuoteInput | null,
  /**
   * A locally computed comparison figure, if the caller has one.
   *
   * Kept through `loading` so the interface is not blank while a quote is in
   * flight — but only ever surfaced as an estimate. It can never become
   * `exact`, because nothing on this side of the wire is entitled to say what
   * something costs.
   */
  estimateCredits?: number,
): QuoteState {
  const initial: QuoteState =
    estimateCredits === undefined
      ? { status: "unavailable" }
      : { status: "estimate", estimateCredits };

  const [state, setState] = useState<QuoteState>(initial);

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
      setState(
        estimateCredits === undefined
          ? { status: "unavailable" }
          : { status: "estimate", estimateCredits },
      );
      return;
    }

    const id = ++latest.current;
    const controller = new AbortController();

    /**
     * Invalidated *now*, not when the reply lands.
     *
     * Any previous `exact` quote is void the instant a setting changes, so
     * Generate is disabled from this moment and nothing can be submitted
     * against the old price. The estimate is carried through because it is
     * still labelled as one.
     */
    setState({ status: "loading", estimateCredits });

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
            setState({ status: "unavailable" });
            return;
          }
          setState({
            status: "exact",
            quote: payload.quote as SequenceQuoteView,
            token: payload.token as string,
            expiresAtMs:
              typeof payload.expiresAtMs === "number"
                ? payload.expiresAtMs
                : Date.now() + PLAN_TTL_MS,
            // The settings this reply answers, not whatever is on screen by
            // the time it lands. The sequence check above already dropped a
            // stale reply; this makes the same fact readable afterwards.
            fingerprint: key,
          });
        })
        .catch(() => {
          if (id !== latest.current) return;
          /**
           * No fallback to the last good price.
           *
           * Not even to the estimate: a figure that survives a failure reads as
           * deliberate, and the whole point of the split is that only a live
           * server answer may look binding.
           */
          setState({ status: "unavailable" });
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, estimateCredits]);

  return state;
}

/** How long a plan token is good for, mirrored from `plan-token.ts`. */
const PLAN_TTL_MS = 600_000;

/**
 * Is this figure binding right now?
 *
 * An expired `exact` quote is not, and the check is here rather than in the
 * hook because time passes between renders: a quote that was current when it
 * arrived stops being current while the user reads it.
 */
export function isExact(
  state: QuoteState,
  nowMs: number = Date.now(),
  /**
   * The settings currently on screen, when the caller has them.
   *
   * Optional because the hook keeps state and screen in step by construction.
   * Passing it turns that from a property of this file into something checked
   * at the point it matters — the button.
   */
  forInput?: SequenceQuoteInput | null,
): boolean {
  if (state.status !== "exact") return false;
  if (state.expiresAtMs <= nowMs) return false;
  if (forInput !== undefined && state.fingerprint !== fingerprintOf(forInput)) {
    return false;
  }
  return true;
}

/**
 * What the Generate button says.
 *
 * The wording carries the status, because the number alone cannot: "180
 * credits" is a promise, "Estimated from 180 credits" is a comparison, and a
 * customer reading the first when we meant the second has been misled.
 */
export function quoteLabel(
  state: QuoteState,
  nowMs: number = Date.now(),
  forInput?: SequenceQuoteInput | null,
): string {
  switch (state.status) {
    case "unavailable":
      return "Quote unavailable — Try again";

    case "estimate":
      return `Estimated from ${state.estimateCredits} credits`;

    case "loading":
      return state.estimateCredits === undefined
        ? "Calculating quote…"
        : `Calculating quote… (estimated from ${state.estimateCredits} credits)`;

    case "exact":
      // An expired quote is not a quote, whatever it used to be.
      return isExact(state, nowMs, forInput)
        ? `Generate · ${state.quote.creditCost} credits`
        : "Quote expired — Try again";
  }
}

/**
 * What a screen reader is told, which is more than the button shows.
 *
 * The visual label leans on context a sighted user has — the settings panel
 * above it, the spinner beside it. Read aloud on its own, "Generate · 180
 * credits" and "Estimated from 180 credits" are the only two strings that
 * distinguish a binding price from a guess, so the accessible name says which
 * one it is in words rather than by formatting.
 */
export function quoteAccessibleLabel(
  state: QuoteState,
  nowMs: number = Date.now(),
  forInput?: SequenceQuoteInput | null,
): string {
  switch (state.status) {
    case "unavailable":
      return "No price is available. Try again.";

    case "estimate":
      return `Estimated from ${state.estimateCredits} credits. Not a final price — Generate is unavailable until the exact price is confirmed.`;

    case "loading":
      return state.estimateCredits === undefined
        ? "Calculating the exact price. Generate is unavailable until it arrives."
        : `Estimated from ${state.estimateCredits} credits. Calculating the exact price; Generate is unavailable until it arrives.`;

    case "exact":
      return isExact(state, nowMs, forInput)
        ? `Generate for ${state.quote.creditCost} credits. This is the exact price.`
        : "This price has expired. Try again for a current one.";
  }
}

/**
 * Generate is only ever enabled against a live, unexpired, unblocked quote.
 *
 * An estimate never qualifies. That is the whole distinction: a comparison
 * figure computed in a browser must not be able to start a charge.
 */
export function canGenerate(
  state: QuoteState,
  nowMs: number = Date.now(),
  forInput?: SequenceQuoteInput | null,
): boolean {
  return (
    isExact(state, nowMs, forInput) &&
    (state as { quote: SequenceQuoteView }).quote.blockers.length === 0
  );
}
