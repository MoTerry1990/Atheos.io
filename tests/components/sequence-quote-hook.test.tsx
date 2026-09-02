import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canGenerate,
  fingerprintOf,
  isExact,
  quoteAccessibleLabel,
  quoteLabel,
  useSequenceQuote,
  type QuoteState,
  type SequenceQuoteInput,
} from "@/features/studio/lib/use-sequence-quote";

/**
 * The price on the button belongs to the settings on screen, or there is none.
 *
 * ## Why a hook needs this much testing
 *
 * Moving the price to the server fixed one bug and opened three, all of which
 * end with a customer reading a number that is not what they will be charged:
 *
 *   - a price that outlives the settings it was quoted for;
 *   - two requests racing, the slower one answering last and winning;
 *   - a failed request falling back to the last good figure, which is the
 *     first bug wearing a helpful face.
 *
 * Each has a test below, and each is written as "what does the interface say
 * at this instant" rather than "was the right function called".
 */

const INPUT: SequenceQuoteInput = {
  publicModelId: "motion-1",
  mode: "continuous",
  prompt: "a sports car on a coastal road",
  durationSeconds: 5,
};

const quotePayload = (creditCost: number) => ({
  ok: true,
  token: "signed.token",
  quote: {
    creditCost,
    providerCalls: 1,
    generatedSeconds: 5,
    assembledDurationSeconds: 5,
    exportResolution: "720p",
    frameRate: 30,
    blockers: [],
    mode: "continuous",
    clipDurationsSeconds: [5],
    modelId: "motion-1",
  },
});

/** Resolves when the test says so, so a race can be staged deliberately. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const flushDebounce = async () => {
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
};

describe("a quote is asked for and shown", () => {
  it("reports the server's figure, not a local calculation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => quotePayload(135) })),
    );

    const { result } = renderHook(() => useSequenceQuote(INPUT));
    await flushDebounce();

    await waitFor(() => expect(result.current.status).toBe("exact"));
    expect(quoteLabel(result.current)).toBe("Generate · 135 credits");
  });

  it("sends a public id and no price at all", async () => {
    /**
     * A client that can name its own price is a client that will name zero.
     * The request body is asserted directly because the schema dropping the
     * field server-side is the second line of defence, not the first.
     */
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      void init;
      return { ok: true, json: async () => quotePayload(90) };
    });
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useSequenceQuote(INPUT));
    await flushDebounce();

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);

    expect(body.modelId).toBe("motion-1");
    expect(body).not.toHaveProperty("creditCost");
    expect(body).not.toHaveProperty("baseCredits");
    expect(body).not.toHaveProperty("price");
    expect(JSON.stringify(body)).not.toMatch(/replicate|admin|role/i);
  });
});

describe("a settings change invalidates immediately", () => {
  it("drops the previous price before the new request is even sent", async () => {
    /**
     * The window this closes is small and real: between changing the model and
     * the new reply landing, the old total sits under the new model's name.
     * Invalidating on the reply would leave it there for the whole round trip.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => quotePayload(90) })),
    );

    const { result, rerender } = renderHook(
      ({ input }) => useSequenceQuote(input),
      { initialProps: { input: INPUT } },
    );
    await flushDebounce();
    await waitFor(() => expect(result.current.status).toBe("exact"));

    rerender({ input: { ...INPUT, publicModelId: "cinematic-fast" } });

    expect(result.current.status).toBe("loading");
    expect(canGenerate(result.current)).toBe(false);
    expect(quoteLabel(result.current)).toBe("Calculating quote…");
  });

  it("invalidates on a duration change too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => quotePayload(90) })),
    );

    const { result, rerender } = renderHook(
      ({ input }) => useSequenceQuote(input),
      { initialProps: { input: INPUT } },
    );
    await flushDebounce();
    await waitFor(() => expect(result.current.status).toBe("exact"));

    rerender({ input: { ...INPUT, durationSeconds: 7.5 } });
    expect(result.current.status).toBe("loading");
  });
});

describe("a late reply never wins", () => {
  it("ignores an older response that resolves after a newer one", async () => {
    /**
     * Type "a", then "ab". The first request is slower and answers last. An
     * `AbortController` alone does not cover this: the request may already
     * have resolved and be queued behind a render.
     */
    const slow = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    const fast = { ok: true, json: async () => quotePayload(500) };

    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        return call === 1 ? slow.promise : fast;
      }),
    );

    const { result, rerender } = renderHook(
      ({ input }) => useSequenceQuote(input),
      { initialProps: { input: INPUT } },
    );
    await flushDebounce();

    // Second request, which answers immediately.
    rerender({ input: { ...INPUT, durationSeconds: 7.5 } });
    await flushDebounce();
    await waitFor(() => expect(result.current.status).toBe("exact"));

    // Now the first one finally lands, carrying a different figure.
    await act(async () => {
      slow.resolve({ ok: true, json: async () => quotePayload(1) });
    });

    expect(quoteLabel(result.current)).toBe("Generate · 500 credits");
  });
});

describe("a failure shows a failure", () => {
  it("does not fall back to the last good price", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        if (call === 1) return { ok: true, json: async () => quotePayload(90) };
        throw new Error("network");
      }),
    );

    const { result, rerender } = renderHook(
      ({ input }) => useSequenceQuote(input),
      { initialProps: { input: INPUT } },
    );
    await flushDebounce();
    await waitFor(() => expect(result.current.status).toBe("exact"));

    rerender({ input: { ...INPUT, durationSeconds: 7.5 } });
    await flushDebounce();

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(quoteLabel(result.current)).toBe("Quote unavailable — Try again");
    expect(quoteLabel(result.current)).not.toMatch(/90/);
  });

  it("treats a refusal from the server as no price", async () => {
    // A model the caller may not run comes back `ok: false`. Showing a price
    // for it would be an offer the server has already declined.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: false, code: "model_unavailable" }),
      })),
    );

    const { result } = renderHook(() => useSequenceQuote(INPUT));
    await flushDebounce();

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(canGenerate(result.current)).toBe(false);
  });
});

describe("Generate is gated on a current price", () => {
  it("is disabled for every status that is not a live exact quote", () => {
    const states: QuoteState[] = [
      { status: "unavailable" },
      { status: "loading" },
      { status: "loading", estimateCredits: 180 },
      { status: "estimate", estimateCredits: 180 },
    ];

    for (const state of states) {
      expect(canGenerate(state), state.status).toBe(false);
    }
  });

  it("is disabled when the quote carries a blocker", async () => {
    /**
     * A priced but unrunnable combination — a mode the model cannot do. The
     * price is real; the work is not available, so the button stays shut.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          const payload = quotePayload(90);
          return {
            ...payload,
            quote: {
              ...payload.quote,
              blockers: ["This model cannot chain shots"],
            },
          };
        },
      })),
    );

    const { result } = renderHook(() => useSequenceQuote(INPUT));
    await flushDebounce();

    await waitFor(() => expect(result.current.status).toBe("exact"));
    expect(canGenerate(result.current)).toBe(false);
  });

  it("is enabled only on a clean, current quote", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => quotePayload(90) })),
    );

    const { result } = renderHook(() => useSequenceQuote(INPUT));
    await flushDebounce();

    await waitFor(() => expect(canGenerate(result.current)).toBe(true));
  });
});

/**
 * What the interface is allowed to say, per state.
 *
 * The previous version of this file searched the rendered component for
 * `\b180 credits\b` and called a match a bug. That is a proxy for the thing
 * that matters and a bad one in both directions: "Estimated from 180 credits"
 * is perfectly honest and would have failed it, while a component that showed
 * "180 credits" under a *stale* exact quote would have passed.
 *
 * The real rule is about which state produced the number and how it is
 * described. So these assert the state, the accessible name and the button —
 * and each is named after the string a customer would actually read.
 */
describe("a number means what its state says it means", () => {
  const NOW = 1_700_000_000_000;
  const ESTIMATE: QuoteState = { status: "estimate", estimateCredits: 180 };

  const exactState = (over: Partial<{ credits: number; ageMs: number }> = {}) =>
    ({
      status: "exact",
      quote: { ...quotePayload(over.credits ?? 180).quote, blockers: [] },
      token: "signed.token",
      expiresAtMs: NOW + (over.ageMs ?? 600_000),
      fingerprint: fingerprintOf(INPUT),
    }) as QuoteState;

  it("'From 180 credits' is a valid estimate", () => {
    // The word "from" is the whole disclosure: it says this is a floor, not a
    // total, which for a multi-clip sequence is exactly what it is.
    expect(quoteLabel(ESTIMATE, NOW)).toBe("Estimated from 180 credits");
    expect(quoteLabel(ESTIMATE, NOW)).toMatch(/^Estimated from /);
  });

  it("'Estimated: 180 credits' is a valid estimate too", () => {
    // Same claim, different wording. What makes either acceptable is that the
    // state is `estimate` and the label carries the qualifier — not the number.
    expect(quoteAccessibleLabel(ESTIMATE, NOW)).toContain(
      "Estimated from 180 credits",
    );
    expect(quoteAccessibleLabel(ESTIMATE, NOW)).toContain("Not a final price");
  });

  it("'180 credits' with no server answer is never produced", () => {
    /**
     * The invalid case, asserted as an absence: no state that lacks a server
     * quote may yield a bare figure. Anchored to the whole number so "180"
     * inside "1800" cannot satisfy or break it, and checked against every
     * non-exact state rather than one.
     */
    const bare = /(?:^|[^\w.])180 credits/;

    const withoutServer: QuoteState[] = [
      ESTIMATE,
      { status: "loading", estimateCredits: 180 },
      { status: "loading" },
      { status: "unavailable" },
    ];

    for (const state of withoutServer) {
      const visible = quoteLabel(state, NOW);
      const spoken = quoteAccessibleLabel(state, NOW);

      // A number may appear — but only ever preceded by "Estimated from".
      if (bare.test(visible)) {
        expect(visible, state.status).toMatch(/[Ee]stimated from 180 credits/);
      }
      expect(visible, state.status).not.toMatch(/^Generate · /);
      expect(spoken, state.status).not.toContain("This is the exact price");
    }
  });

  it("'Exact quote: 180 credits' needs a current server quote", () => {
    const live = exactState();

    expect(quoteLabel(live, NOW)).toBe("Generate · 180 credits");
    expect(quoteAccessibleLabel(live, NOW)).toContain(
      "This is the exact price",
    );
    expect(isExact(live, NOW)).toBe(true);
    expect(canGenerate(live, NOW)).toBe(true);
  });

  it("keeps Generate shut whenever only an estimate exists", () => {
    // The single most important line in the file: a figure computed in a
    // browser must not be able to start a charge.
    expect(canGenerate(ESTIMATE, NOW)).toBe(false);
    expect(isExact(ESTIMATE, NOW)).toBe(false);
    expect(quoteAccessibleLabel(ESTIMATE, NOW)).toContain(
      "Generate is unavailable",
    );
  });

  it("a quote for other settings is not a quote for these", () => {
    /**
     * The fingerprint check, exercised directly rather than through the hook.
     * The hook resets to `loading` on a settings change, so this state should
     * not arise — but "should not arise" is why it is worth an assertion, and
     * a consumer holding a state across a change would otherwise be told it
     * was current.
     */
    const stale = exactState();
    const different = { ...INPUT, durationSeconds: 7.5 };

    expect(isExact(stale, NOW, INPUT)).toBe(true);
    expect(isExact(stale, NOW, different)).toBe(false);
    expect(canGenerate(stale, NOW, different)).toBe(false);
    expect(quoteLabel(stale, NOW, different)).toBe("Quote expired — Try again");
  });

  it("an expired quote never reads as exact again", () => {
    // Ten minutes and one millisecond later. The state object is unchanged —
    // only time passed, which is the point: nothing re-renders to make a quote
    // stale, so staleness has to be evaluated at read time.
    const live = exactState();

    expect(isExact(live, NOW)).toBe(true);
    expect(isExact(live, NOW + 600_001)).toBe(false);
    expect(canGenerate(live, NOW + 600_001)).toBe(false);
    expect(quoteLabel(live, NOW + 600_001)).toBe("Quote expired — Try again");
    expect(quoteLabel(live, NOW + 600_001)).not.toMatch(/180/);
  });

  it("carries no price or token once unavailable", () => {
    // Asserted structurally: the variant has no fields to hold one, so a
    // fallback would have to be a deliberate widening of the type.
    const dead: QuoteState = { status: "unavailable" };

    expect(Object.keys(dead)).toEqual(["status"]);
    expect(JSON.stringify(dead)).not.toMatch(/\d/);
  });
});

describe("a settings change keeps the estimate and drops the quote", () => {
  it("falls back to a labelled estimate, never to the old total", async () => {
    /**
     * The sixth rule, end to end. Changing the duration must void the exact
     * price immediately — but going blank on every keystroke is its own kind
     * of bad interface, so the local estimate may stay *provided it says so*.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => quotePayload(360) })),
    );

    const { result, rerender } = renderHook(
      ({ input }) => useSequenceQuote(input, 180),
      { initialProps: { input: INPUT } },
    );
    await flushDebounce();
    await waitFor(() => expect(result.current.status).toBe("exact"));
    expect(quoteLabel(result.current)).toBe("Generate · 360 credits");

    rerender({ input: { ...INPUT, durationSeconds: 7.5 } });

    expect(result.current.status).toBe("loading");
    expect(canGenerate(result.current)).toBe(false);

    // The estimate survives; the 360 does not.
    const label = quoteLabel(result.current);
    expect(label).toContain("estimated from 180 credits");
    expect(label).not.toMatch(/360/);
    expect(quoteAccessibleLabel(result.current)).toContain(
      "Generate is unavailable",
    );
  });

  it("drops even the estimate when the request fails", async () => {
    // A failure is not an occasion to show a cheaper number with a friendly
    // face. `unavailable` has nowhere to put one.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );

    const { result } = renderHook(() => useSequenceQuote(INPUT, 180));
    await flushDebounce();

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(quoteLabel(result.current)).not.toMatch(/180/);
  });
});
