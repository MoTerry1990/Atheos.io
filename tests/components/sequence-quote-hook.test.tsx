import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canGenerate,
  quoteLabel,
  useSequenceQuote,
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

    await waitFor(() => expect(result.current.status).toBe("ready"));
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
    await waitFor(() => expect(result.current.status).toBe("ready"));

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
    await waitFor(() => expect(result.current.status).toBe("ready"));

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
    await waitFor(() => expect(result.current.status).toBe("ready"));

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
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ input: { ...INPUT, durationSeconds: 7.5 } });
    await flushDebounce();

    await waitFor(() => expect(result.current.status).toBe("error"));
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

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(canGenerate(result.current)).toBe(false);
  });
});

describe("Generate is gated on a current price", () => {
  it("is disabled while idle, loading and failed", () => {
    for (const state of [
      { status: "idle" } as const,
      { status: "loading" } as const,
      { status: "error" } as const,
    ]) {
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

    await waitFor(() => expect(result.current.status).toBe("ready"));
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
