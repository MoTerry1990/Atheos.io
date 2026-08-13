import { afterEach, describe, expect, it, vi } from "vitest";

import { enhancePrompt } from "@/services/ai/enhance";

// The real `env` validates at import time and has no provider token under
// test, which would make every case below take the "no token" early return and
// pass for the wrong reason — including the two that assert a real expansion.
vi.mock("@/lib/env", () => ({
  env: { REPLICATE_API_TOKEN: "r8_test_token" },
}));

/**
 * Prompt enhancement, at its two failure surfaces.
 *
 * The output of this function goes **straight into a field the user will
 * submit**, so the two things worth pinning are that model chatter never
 * survives to get there, and that nothing — a timeout, a 500, a refusal, a
 * missing key — ever destroys what they already typed.
 */

const ORIGINAL = "a cat on a roof";

function replyWith(output: string[] | string, status = "succeeded") {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status, output }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("enhancePrompt", () => {
  it("joins the streamed token fragments without separators", async () => {
    // Llama returns an array of tokens. Joining with a space produces
    // "A m a jestic cat", which looks like a broken model rather than a bug.
    vi.stubGlobal(
      "fetch",
      replyWith(["A majestic ", "tabby cat ", "on a rusted tin roof at dusk."]),
    );

    const result = await enhancePrompt(ORIGINAL);
    expect(result.prompt).toBe(
      "A majestic tabby cat on a rusted tin roof at dusk.",
    );
    expect(result.changed).toBe(true);
  });

  it("strips the preamble the model was told not to write", async () => {
    vi.stubGlobal(
      "fetch",
      replyWith(
        "Here is an enhanced prompt: A majestic tabby cat sits on a rusted tin roof, backlit by a low sun.",
      ),
    );

    const result = await enhancePrompt(ORIGINAL);
    expect(result.prompt).toMatch(/^A majestic tabby cat/);
  });

  it("strips wrapping quotes, straight and curly", async () => {
    vi.stubGlobal(
      "fetch",
      replyWith('"A tabby cat on a rusted tin roof, low golden sun."'),
    );

    const straight = await enhancePrompt(ORIGINAL);
    expect(straight.prompt.startsWith('"')).toBe(false);
    expect(straight.prompt.endsWith('"')).toBe(false);

    vi.stubGlobal(
      "fetch",
      replyWith("“A tabby cat on a rusted tin roof, low sun.”"),
    );
    const curly = await enhancePrompt(ORIGINAL);
    expect(curly.prompt.startsWith("“")).toBe(false);
  });

  it("returns the original when the model replies with something shorter", async () => {
    // A refusal, or a truncation. Accepting it would delete the user's prompt
    // and replace it with "I cannot help with that."
    vi.stubGlobal("fetch", replyWith("No."));

    const result = await enhancePrompt(ORIGINAL);
    expect(result).toEqual({ prompt: ORIGINAL, changed: false });
  });

  it("returns the original when the prediction did not succeed", async () => {
    vi.stubGlobal("fetch", replyWith("anything at all", "failed"));

    const result = await enhancePrompt(ORIGINAL);
    expect(result).toEqual({ prompt: ORIGINAL, changed: false });
  });

  it("returns the original when the request throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network is unreachable")),
    );

    const result = await enhancePrompt(ORIGINAL);
    expect(result).toEqual({ prompt: ORIGINAL, changed: false });
  });

  it("returns the original when the provider responds with an error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );

    const result = await enhancePrompt(ORIGINAL);
    expect(result).toEqual({ prompt: ORIGINAL, changed: false });
  });

  it("does not call the provider for input too short to expand", async () => {
    const fetchMock = replyWith("something long and descriptive");
    vi.stubGlobal("fetch", fetchMock);

    const result = await enhancePrompt("a");
    expect(result).toEqual({ prompt: "a", changed: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves a long, considered prompt alone", async () => {
    const fetchMock = replyWith("more words");
    vi.stubGlobal("fetch", fetchMock);

    // Someone who has written 600 characters knows what they want. Rewriting it
    // is not a favour, and it is the case where an unwanted overwrite hurts most.
    const long = "x".repeat(601);
    const result = await enhancePrompt(long);
    expect(result.changed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
