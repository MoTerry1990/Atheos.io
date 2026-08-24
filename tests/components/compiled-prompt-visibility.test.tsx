import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PromptEditor } from "@/features/studio/components/prompt-editor";
import { useStudioStore } from "@/store/studio-store";

/**
 * What gets sent is always on screen.
 *
 * ## Why this needs a test rather than a glance
 *
 * The panel used to be gated twice over: behind a `hasAdditions` check *and*
 * behind a show/hide toggle that defaulted closed. The effect was that the
 * common path — type a prompt, press Generate — never revealed the string
 * actually submitted. It only appeared once a style preset or camera option had
 * been picked, which is the case where a user already knows something was
 * added.
 *
 * Nothing should be sent on a user's behalf that they cannot read first, and
 * the failure mode here is silent: the panel not rendering looks exactly like a
 * panel with nothing to say.
 */

vi.mock("@/lib/toast", () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    message: vi.fn(),
  },
}));

const CAMERA_EMPTY = { shot: null, angle: null, lens: null, lighting: null };

/** Put the composer in a known state without going through the UI. */
function setParams(over: Record<string, unknown>) {
  useStudioStore.setState((state) => ({
    params: {
      ...state.params,
      prompt: "",
      presetIds: [],
      camera: { ...CAMERA_EMPTY },
      ...over,
    },
  }));
}

beforeEach(() => {
  setParams({});
});

/** The panel's own heading — the anchor for every assertion below. */
const panel = () => screen.queryByText("Submitted as");

/**
 * The panel's body text.
 *
 * Scoped to the panel rather than the document: the prompt also sits in the
 * textarea, so a bare `getByText` matches twice and would pass even if the
 * panel had not rendered at all.
 */
function panelText(): string {
  const heading = panel();
  if (!heading) throw new Error("the compiled-prompt panel did not render");
  return heading.parentElement?.textContent ?? "";
}

describe("the compiled prompt is visible before generating", () => {
  it("shows in the empty state, before anything is typed", () => {
    /**
     * The panel holds its place rather than appearing on first keystroke.
     * "We will show you what gets sent" should be true when the user arrives,
     * not conditional on them having started.
     */
    render(<PromptEditor />);

    expect(panel()).toBeTruthy();
    expect(panelText()).toContain(
      "Nothing yet — your prompt will appear here.",
    );
  });

  it("shows with a prompt and no preset selected", () => {
    // The case the old gate missed entirely.
    setParams({ prompt: "a lighthouse in fog" });
    render(<PromptEditor />);

    expect(panel()).toBeTruthy();
    expect(panelText()).toContain("a lighthouse in fog");
  });

  it("shows with a preset selected, and explains the additions", () => {
    setParams({
      prompt: "a lighthouse in fog",
      camera: { ...CAMERA_EMPTY, shot: "wide shot" },
    });
    render(<PromptEditor />);

    expect(panel()).toBeTruthy();
    expect(panelText()).toContain("a lighthouse in fog, wide shot");
    // The explanatory line appears only when something was actually appended.
    expect(panelText()).toContain("appended to your prompt");
  });

  it("omits the explanation when nothing was appended", () => {
    // Nothing to explain, so the line would be noise rather than disclosure.
    setParams({ prompt: "a lighthouse in fog" });
    render(<PromptEditor />);

    expect(panelText()).not.toContain("appended to your prompt");
  });

  it("is not behind a toggle", () => {
    /**
     * The show/hide button is gone. A disclosure the user has to find is not
     * disclosure — and its default was closed.
     */
    setParams({ prompt: "a lighthouse in fog" });
    render(<PromptEditor />);

    expect(screen.queryByRole("button", { name: /final prompt/i })).toBeNull();
  });
});

describe("what the panel shows is what would be submitted", () => {
  it("matches the assembled string exactly, separators included", () => {
    // A preview that differs from the payload is worse than no preview.
    setParams({
      prompt: "a lighthouse in fog,",
      camera: { ...CAMERA_EMPTY, shot: "wide shot" },
    });
    render(<PromptEditor />);

    // The trailing comma is stripped before joining, so no doubled separator
    // reaches either the screen or the provider.
    expect(panelText()).toContain("a lighthouse in fog, wide shot");
    expect(panelText()).not.toMatch(/,\s*,/);
  });
});
