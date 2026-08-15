import { describe, expect, it } from "vitest";

/**
 * The URL the landing composer builds.
 *
 * The prompt is encoded **twice** on purpose, and it is the kind of thing that
 * gets "simplified" by the next person to read it. The inner encoding protects
 * the prompt's own `&` and `=` inside the studio's query string; the outer one
 * protects that whole string as the value of Clerk's `redirect_url`. Encode
 * once and a prompt containing an ampersand truncates the destination — the
 * user lands on `/studio` with half a sentence, or on the dashboard.
 *
 * Kept in step with `home-composer.tsx` by hand: the component is a client
 * component and importing it here would pull React and the i18n provider into
 * a unit test for a string.
 */
function destinationFor(prompt: string, modality: "image" | "video") {
  const studio = prompt.trim()
    ? `/studio?prompt=${encodeURIComponent(prompt.trim())}&modality=${modality}`
    : "/studio";

  return `/sign-up?redirect_url=${encodeURIComponent(studio)}`;
}

describe("home composer destination", () => {
  it("always lands on sign-up, never on an anchor", () => {
    expect(destinationFor("a cat", "image").startsWith("/sign-up?")).toBe(true);
  });

  it("survives a prompt containing & and =", () => {
    const prompt = "neon & rain, ratio=16:9";
    const url = destinationFor(prompt, "video");

    // `searchParams.get` decodes once already — that is the outer layer
    // stripped. Decoding again here would strip the *inner* layer too and
    // turn the prompt's own `&` back into a separator, which is precisely the
    // failure the double encoding exists to prevent. (This test did exactly
    // that on its first run and reported a bug in correct code.)
    const redirect =
      new URL(url, "https://x.test").searchParams.get("redirect_url") ?? "";
    const studio = new URL(redirect, "https://x.test");

    expect(studio.pathname).toBe("/studio");
    expect(studio.searchParams.get("prompt")).toBe(prompt);
    expect(studio.searchParams.get("modality")).toBe("video");
  });

  it("omits the prompt entirely when the field is empty", () => {
    const redirect =
      new URL(
        destinationFor("   ", "image"),
        "https://x.test",
      ).searchParams.get("redirect_url") ?? "";

    expect(redirect).toBe("/studio");
  });
});
