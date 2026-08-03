import { describe, expect, it } from "vitest";

import {
  HANDLE_MAX,
  HANDLE_MIN,
  isReserved,
  normaliseHandle,
  slugify,
  validateHandle,
} from "@/services/community/handles";

/**
 * A handle is a public identity in a URL. Getting validation wrong means either
 * a broken route or — the reason the ASCII rule exists — two accounts that look
 * identical to a human.
 */
describe("normaliseHandle", () => {
  it("lowercases and trims", () => {
    expect(normaliseHandle("  MauRo  ")).toBe("mauro");
  });
});

describe("validateHandle", () => {
  it("accepts a plain handle", () => {
    expect(validateHandle("mauro")).toBeNull();
  });

  it("accepts digits, underscores and hyphens inside", () => {
    expect(validateHandle("mau_ro-99")).toBeNull();
  });

  it("validates the normalised form, not the raw input", () => {
    expect(validateHandle("  MAURO  ")).toBeNull();
  });

  it("rejects too short and too long", () => {
    expect(validateHandle("a".repeat(HANDLE_MIN - 1))).toBe("too_short");
    expect(validateHandle("a".repeat(HANDLE_MAX + 1))).toBe("too_long");
  });

  it("accepts exactly the boundary lengths", () => {
    expect(validateHandle("a".repeat(HANDLE_MIN))).toBeNull();
    expect(validateHandle("a".repeat(HANDLE_MAX))).toBeNull();
  });

  it("rejects non-ASCII lookalikes", () => {
    // "аdmin" with a Cyrillic а. Indistinguishable in most fonts from "admin",
    // which is exactly the impersonation this rule exists to prevent.
    expect(validateHandle("аdmin")).toBe("invalid_characters");
    expect(validateHandle("mauroé")).toBe("invalid_characters");
  });

  it("rejects spaces, dots and slashes", () => {
    for (const bad of ["ma uro", "ma.uro", "ma/uro", "ma@uro"]) {
      expect(validateHandle(bad), bad).toBe("invalid_characters");
    }
  });

  it("rejects leading or trailing punctuation", () => {
    for (const bad of ["-mauro", "mauro-", "_mauro", "mauro_"]) {
      expect(validateHandle(bad), bad).toBe("edge_punctuation");
    }
  });

  it("rejects reserved words", () => {
    expect(validateHandle("admin")).toBe("reserved");
  });

  it("rejects a reserved word regardless of case", () => {
    expect(validateHandle("ADMIN")).toBe("reserved");
  });
});

describe("isReserved", () => {
  it("normalises before checking", () => {
    expect(isReserved("  Admin ")).toBe(true);
    expect(isReserved("mauro")).toBe(false);
  });
});

describe("slugify", () => {
  it("produces a URL-safe slug", () => {
    expect(slugify("My First Project")).toBe("my-first-project");
  });

  it("strips punctuation rather than encoding it", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
  });

  it("falls back when the input reduces to nothing", () => {
    // A name made entirely of punctuation or non-Latin script would otherwise
    // produce an empty slug and a URL ending in a bare slash.
    expect(slugify("!!!")).toBe("collection");
    expect(slugify("   ")).toBe("collection");
  });

  it("honours a custom fallback", () => {
    expect(slugify("???", "untitled")).toBe("untitled");
  });

  it("never emits leading or trailing hyphens", () => {
    for (const input of ["  spaced  ", "--dashed--", "!bang!"]) {
      const slug = slugify(input);
      expect(slug.startsWith("-"), input).toBe(false);
      expect(slug.endsWith("-"), input).toBe(false);
    }
  });
});
