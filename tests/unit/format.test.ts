import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatCredits,
  formatCurrency,
  formatDuration,
  formatRelativeTime,
  truncatePrompt,
} from "@/utils/format";

/**
 * Formatting is where a real bug already shipped: a credit-pack line read
 * "120.00¢ per credit" because minor units were multiplied by 100 twice. These
 * are pure functions displaying money and quantities, which is the cheapest
 * place in the project to catch that class of mistake.
 */
describe("formatBytes", () => {
  it("handles zero without producing NaN", () => {
    expect(formatBytes(0)).toMatch(/0/);
  });

  it("scales through the units", () => {
    expect(formatBytes(1024)).toMatch(/1(\.0)?\s?KB/i);
    expect(formatBytes(1024 * 1024)).toMatch(/1(\.0)?\s?MB/i);
    expect(formatBytes(1024 * 1024 * 1024)).toMatch(/1(\.0)?\s?GB/i);
  });

  it("respects the decimals argument", () => {
    expect(formatBytes(1536, 0)).not.toMatch(/\./);
  });
});

describe("formatDuration", () => {
  it("formats sub-minute durations", () => {
    expect(formatDuration(5_000)).toMatch(/5/);
  });

  it("formats durations past a minute", () => {
    expect(formatDuration(90_000)).toMatch(/1/);
  });

  it("does not throw on zero", () => {
    expect(() => formatDuration(0)).not.toThrow();
  });
});

describe("formatCredits", () => {
  it("groups thousands", () => {
    expect(formatCredits(1000)).toMatch(/1[,.\s]000/);
  });

  it("renders zero as zero, not as blank", () => {
    expect(formatCredits(0)).toMatch(/0/);
  });

  it("renders a negative balance with its sign", () => {
    // A negative balance should be impossible — the ledger guards it — but if
    // one ever renders, it must not silently look positive.
    expect(formatCredits(-50)).toMatch(/-/);
  });
});

describe("formatCurrency", () => {
  it("renders minor units as a major-unit amount", () => {
    // 1999 minor units is $19.99. The bug this guards against multiplied by
    // 100 a second time and produced "1,999.00".
    const out = formatCurrency(1999);
    expect(out).toMatch(/19[.,]99/);
    expect(out).not.toMatch(/1[,.]999[.,]00/);
  });

  it("renders zero", () => {
    expect(formatCurrency(0)).toMatch(/0/);
  });

  it("does not lose the cents on a round amount", () => {
    expect(formatCurrency(2000)).toMatch(/20[.,]00/);
  });
});

describe("formatRelativeTime", () => {
  it("accepts a Date, a string and a number", () => {
    const now = Date.now();
    for (const input of [new Date(now), new Date(now).toISOString(), now]) {
      expect(() => formatRelativeTime(input)).not.toThrow();
    }
  });

  it("describes the recent past as past", () => {
    const out = formatRelativeTime(Date.now() - 60_000);
    expect(out).toMatch(/ago|now|minute/i);
  });

  it("does not crash on a far-future date", () => {
    expect(() => formatRelativeTime(Date.now() + 86_400_000)).not.toThrow();
  });
});

describe("truncatePrompt", () => {
  it("leaves a short prompt untouched", () => {
    expect(truncatePrompt("a cat")).toBe("a cat");
  });

  it("truncates a long prompt to the limit", () => {
    const long = "x".repeat(500);
    const out = truncatePrompt(long, 50);
    expect(out.length).toBeLessThanOrEqual(51); // allow for an ellipsis glyph
  });

  it("marks that it truncated", () => {
    const out = truncatePrompt("y".repeat(500), 20);
    expect(out).toMatch(/[.…]/);
  });

  it("does not truncate at exactly the limit", () => {
    const exact = "z".repeat(20);
    expect(truncatePrompt(exact, 20)).toBe(exact);
  });
});
