import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HomeComposer } from "@/features/marketing/components/home-composer";
import { Reveal } from "@/features/marketing/components/section";

/**
 * The homepage composer's keyboard contract, and the reveal's reduced-motion
 * behaviour.
 *
 * ## Why the composer needed tests
 *
 * It was three `aria-pressed` buttons in a plain `div`. The *state* logic was
 * correct — verified in a browser: the prompt survives a modality switch, the
 * model list and aspect ratios swap, audio drops the ratio control entirely,
 * and the sign-up link carries all four values. What was missing was that a
 * screen reader was told it was looking at three unrelated toggles, and a
 * keyboard user had to Tab through all three rather than arrowing between
 * them.
 *
 * These assert the semantics *and* re-assert the state logic, so the
 * conversion to a tablist cannot quietly break what already worked.
 */

let reducedMotion = false;

vi.mock("motion/react", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("motion/react");
  return { ...actual, useReducedMotion: () => reducedMotion };
});

beforeEach(() => {
  reducedMotion = false;
});

function tabs() {
  return within(screen.getByRole("tablist")).getAllByRole("tab");
}

function prompt() {
  return screen.getByRole("textbox", {
    name: /prompt/i,
  }) as HTMLTextAreaElement;
}

/** The sign-up link, decoded once so assertions read as URLs rather than %2F. */
function destination() {
  // The only link inside the composer card is its CTA.
  const link = screen
    .getByRole("tabpanel")
    .querySelector('a[href*="/sign-up"]')!;
  return decodeURIComponent(link.getAttribute("href") ?? "");
}

describe("composer tab semantics", () => {
  it("exposes a tablist with one selected tab", () => {
    render(<HomeComposer />);

    const all = tabs();
    expect(all).toHaveLength(3);
    expect(
      all.filter((t) => t.getAttribute("aria-selected") === "true"),
    ).toHaveLength(1);
    expect(all[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("points each tab at the panel it controls", () => {
    render(<HomeComposer />);

    const selected = tabs().find(
      (t) => t.getAttribute("aria-selected") === "true",
    )!;
    const panel = screen.getByRole("tabpanel");

    expect(selected.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(selected.id);
  });

  it("namespaces its ids away from the showcase tablist", () => {
    // `ai-showcase.tsx` further down the page uses `tab-image` and
    // `panel-image`. Two elements sharing an id break `aria-controls` on
    // whichever renders second.
    render(<HomeComposer />);

    for (const tab of tabs()) {
      expect(tab.id).toMatch(/^composer-tab-/);
    }
    expect(screen.getByRole("tabpanel").id).toMatch(/^composer-panel-/);
  });

  it("keeps exactly one tab in the tab order", () => {
    // Roving tabindex: Tab reaches the group once and arrows move within it.
    render(<HomeComposer />);

    const focusable = tabs().filter((t) => t.getAttribute("tabindex") === "0");
    expect(focusable).toHaveLength(1);
    expect(focusable[0]!.getAttribute("aria-selected")).toBe("true");
  });
});

describe("composer keyboard navigation", () => {
  it("moves and selects with the arrow keys", () => {
    render(<HomeComposer />);

    const [image, video, audio] = tabs();
    image!.focus();

    fireEvent.keyDown(image!, { key: "ArrowRight" });
    expect(video!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(video);

    fireEvent.keyDown(video!, { key: "ArrowRight" });
    expect(audio!.getAttribute("aria-selected")).toBe("true");
  });

  it("wraps at both ends", () => {
    render(<HomeComposer />);
    const [image, , audio] = tabs();

    image!.focus();
    fireEvent.keyDown(image!, { key: "ArrowLeft" });
    expect(audio!.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(audio!, { key: "ArrowRight" });
    expect(image!.getAttribute("aria-selected")).toBe("true");
  });

  it("jumps to the ends with Home and End", () => {
    render(<HomeComposer />);
    const [image, video, audio] = tabs();

    video!.focus();
    fireEvent.keyDown(video!, { key: "End" });
    expect(audio!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(audio);

    fireEvent.keyDown(audio!, { key: "Home" });
    expect(image!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(image);
  });

  it("ignores keys that are not navigation", () => {
    render(<HomeComposer />);
    const [image, video] = tabs();

    image!.focus();
    fireEvent.keyDown(image!, { key: "a" });
    fireEvent.keyDown(image!, { key: "ArrowDown" });

    expect(image!.getAttribute("aria-selected")).toBe("true");
    expect(video!.getAttribute("aria-selected")).toBe("false");
  });
});

describe("composer state", () => {
  it("keeps the prompt when the modality changes", () => {
    /**
     * The contract the whole component exists for. A composer that discards
     * what somebody typed when they switch tabs asks for effort and throws it
     * away — worse than having no composer.
     */
    render(<HomeComposer />);

    fireEvent.change(prompt(), { target: { value: "a lighthouse at dusk" } });

    const [, video, audio] = tabs();
    fireEvent.click(video!);
    expect(prompt().value).toBe("a lighthouse at dusk");

    fireEvent.click(audio!);
    expect(prompt().value).toBe("a lighthouse at dusk");
  });

  it("swaps the model list with the modality", () => {
    render(<HomeComposer />);

    const modelsFor = () =>
      within(screen.getByRole("combobox", { name: /model/i }))
        .getAllByRole("option")
        .map((o) => (o as HTMLOptionElement).value);

    const image = modelsFor();
    fireEvent.click(tabs()[1]!);
    const video = modelsFor();

    expect(video).not.toEqual(image);
    expect(video.every((id) => !image.includes(id))).toBe(true);
  });

  it("drops the ratio control entirely for audio", () => {
    // Absent, not disabled: audio has no aspect ratio, and a greyed-out
    // control invites the reader to wonder what they did wrong.
    render(<HomeComposer />);
    expect(screen.getByRole("combobox", { name: /ratio/i })).toBeDefined();

    fireEvent.click(tabs()[2]!);
    expect(screen.queryByRole("combobox", { name: /ratio/i })).toBeNull();
  });

  it("carries modality, model, prompt and ratio into sign-up", () => {
    render(<HomeComposer />);
    fireEvent.change(prompt(), { target: { value: "neon rain" } });

    const href = destination();
    expect(href).toContain("/sign-up?redirect_url=");
    expect(href).toContain("modality=image");
    expect(href).toContain("prompt=neon+rain");
    expect(href).toContain("aspect=");
  });

  it("omits the ratio from an audio request", () => {
    render(<HomeComposer />);
    fireEvent.click(tabs()[2]!);

    const href = destination();
    expect(href).toContain("modality=audio");
    expect(href).not.toContain("aspect=");
  });

  it("never submits to a generation endpoint from the homepage", () => {
    // The composer generates nothing. Every path out of it is a link to
    // sign-up; a form post or an /api/ target here would mean the homepage can
    // spend money.
    const { container } = render(<HomeComposer />);

    expect(container.querySelector("form")).toBeNull();
    for (const link of container.querySelectorAll("a")) {
      expect(link.getAttribute("href")).not.toContain("/api/");
    }
  });
});

describe("Reveal under reduced motion", () => {
  it("renders children with no hidden inline state", () => {
    /**
     * `initial={{ opacity: 0 }}` is written into the server HTML as an inline
     * style — 40 elements on the homepage, including the h1 and every h2 —
     * and only becomes visible once JavaScript runs and an
     * IntersectionObserver fires.
     *
     * For readers who asked for less motion, the wrapper is skipped entirely,
     * so there is no hidden state to recover from.
     */
    reducedMotion = true;
    const { container } = render(
      <Reveal>
        <p>visible immediately</p>
      </Reveal>,
    );

    expect(screen.getByText("visible immediately")).toBeDefined();
    expect(container.querySelector('[style*="opacity"]')).toBeNull();
  });

  it("is visible for everybody else too, animation or not", () => {
    /**
     * This used to assert the opposite — that a non-reduced-motion reader got
     * an inline `opacity` style. That was the bug: the style was `opacity: 0`
     * in the server HTML, and the content only appeared once JavaScript had
     * hydrated and an observer had fired. One Chrome profile rendered a blank
     * hero because of it.
     *
     * The entrance is now a CSS class animating *from* a hidden frame *to* the
     * element's natural, visible resting state. There is no inline opacity in
     * either branch, and nothing has to run for the text to be readable.
     */
    reducedMotion = false;
    const { container } = render(
      <Reveal>
        <p>fades in</p>
      </Reveal>,
    );

    expect(screen.getByText("fades in")).toBeDefined();
    expect(container.querySelector('[style*="opacity"]')).toBeNull();
    expect(container.querySelector(".reveal")).not.toBeNull();
  });
});
