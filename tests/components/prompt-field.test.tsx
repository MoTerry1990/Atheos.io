import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  PROMPT_PLACEHOLDERS,
  PromptField,
} from "@/features/studio/components/prompt-field";

/**
 * The prompt field, rendered.
 *
 * ## Why these are render tests
 *
 * The studio needs a signed-in session and a live model catalogue, so the field
 * cannot be opened in a production build without one. Rendering the component
 * directly asserts the thing a user actually meets — the padding class that
 * keeps text off the border, the placeholder for the mode they picked, and the
 * shortcut that spends their credits.
 *
 * jsdom has no layout engine, so pixel heights are asserted through the style
 * and class values that produce them rather than through `getBoundingClientRect`,
 * which reports zero for everything.
 */

function setup(overrides: Partial<Parameters<typeof PromptField>[0]> = {}) {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  const utils = render(
    <PromptField
      value=""
      onChange={onChange}
      modality="IMAGE"
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  // Scoped to this render's own container: several tests render more than once,
  // and a screen-wide query would find the first field rather than the newest.
  const field = utils.container.querySelector(
    "textarea",
  ) as HTMLTextAreaElement;
  return { ...utils, field, onChange, onSubmit };
}

describe("spacing keeps text off the border", () => {
  it("applies the padding the redesign specifies", () => {
    const { field } = setup();
    /**
     * 18px left and 16px top/bottom, inside the 16–20 / 14–18 range asked for.
     *
     * Asserted as `pl` rather than `px`: the first version used `px-[18px]`
     * alongside `pr-12`, the two conflicted, and the browser resolved the left
     * padding to 0 while this class string still looked right. The class test
     * passed and the field had text against the border — which is why the
     * rendered value is checked in the browser as well as here.
     */
    expect(field.className).toMatch(/pl-\[18px\]/);
    expect(field.className).toMatch(/py-4/);
    expect(field.className).not.toMatch(/px-\[18px\]/);
  });

  it("reserves a right-hand gutter for injected extension buttons", () => {
    /**
     * Grammarly and friends drop a floating button into the bottom-right of any
     * textarea they attach to. We cannot control that; we can refuse to put
     * words underneath it.
     */
    const { field } = setup();
    expect(field.className).toMatch(/pr-12/);
  });

  it("uses a reading line-height rather than a form one", () => {
    const { field } = setup();
    expect(field.className).toMatch(/leading-\[1\.6\]/);
    // The placeholder is multi-line, so it needs the same.
    expect(field.className).toMatch(/placeholder:leading-\[1\.6\]/);
  });

  it("starts tall enough for a paragraph", () => {
    // 140px, within the 120–150 the redesign asks for.
    const { field } = setup();
    expect(field.style.minHeight).toBe("140px");
  });
});

describe("mode-specific placeholders", () => {
  it("asks for an image description in image mode", () => {
    const { field } = setup({ modality: "IMAGE" });
    expect(field.placeholder).toMatch(/Describe the image you want to create/);
    expect(field.placeholder).toMatch(/aerial drone photograph/);
  });

  it("asks for movement and camera in video mode", () => {
    const { field } = setup({ modality: "VIDEO" });
    expect(field.placeholder).toMatch(/subject movement, and camera movement/);
  });

  it("asks for sound, mood and duration in audio mode", () => {
    const { field } = setup({ modality: "AUDIO" });
    expect(field.placeholder).toMatch(
      /sound, music, voice, mood, and duration/,
    );
    // Audio has no camera and no example — inventing one would teach the wrong
    // vocabulary for the mode.
    expect(field.placeholder).not.toMatch(/Example:/);
  });

  it("never puts the example into the value", () => {
    // The most important line in this file. A prefilled example is a prompt the
    // user did not write and may pay to generate.
    const { field } = setup();
    expect(field.value).toBe("");
    for (const placeholder of Object.values(PROMPT_PLACEHOLDERS)) {
      expect(field.value).not.toBe(placeholder);
    }
  });
});

describe("multiline text is preserved exactly", () => {
  it("keeps line breaks as entered", () => {
    const { field, onChange } = setup();
    const multiline = "first line\n\nthird line\n  indented";
    fireEvent.change(field, { target: { value: multiline } });
    expect(onChange).toHaveBeenCalledWith(multiline);
  });

  it("preserves accented and Spanish text unchanged", () => {
    const { field, onChange } = setup();
    const spanish =
      "Un carro rojo convertible corriendo por la carretera, con el mar al " +
      "costado. La niña sonríe; el sol está en lo alto — ¿se ve el cielo?";
    fireEvent.change(field, { target: { value: spanish } });
    expect(onChange).toHaveBeenCalledWith(spanish);
  });

  it("accepts a long pasted prompt without truncating", () => {
    const { field, onChange } = setup();
    const long = "una toma aérea del carro rojo. ".repeat(80);
    fireEvent.change(field, { target: { value: long } });
    expect(onChange).toHaveBeenCalledWith(long);
    expect(onChange.mock.calls[0][0]).toHaveLength(long.length);
  });
});

describe("the generate shortcut", () => {
  it("fires on Ctrl+Enter with text", () => {
    const { field, onSubmit } = setup({ value: "a red car" });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("fires on Cmd+Enter", () => {
    const { field, onSubmit } = setup({ value: "a red car" });
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does nothing on Enter alone, which is a new line", () => {
    const { field, onSubmit } = setup({ value: "a red car" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not fire while an IME is composing", () => {
    /**
     * Typing Japanese, Chinese or Korean routes through a composition session
     * in which Enter commits the candidate word rather than ending the
     * sentence. Generating there would submit a half-written prompt and charge
     * for it.
     */
    const { field, onSubmit } = setup({ value: "赤い車" });
    fireEvent.compositionStart(field);
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.compositionEnd(field);
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty or whitespace-only prompt", () => {
    for (const value of ["", "   ", "\n\n"]) {
      const { field, onSubmit } = setup({ value });
      fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
      expect(onSubmit, JSON.stringify(value)).not.toHaveBeenCalled();
    }
  });

  it("refuses to submit while disabled, so a run cannot be doubled", () => {
    const { field, onSubmit } = setup({ value: "a red car", disabled: true });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the shortcut rather than expecting people to guess", () => {
    setup();
    expect(screen.getByText(/Enter to generate/)).toBeTruthy();
  });
});

describe("destructive actions are hard to do by accident", () => {
  it("blurs on Escape and never clears", () => {
    /**
     * Escape is the key people press to dismiss things. Losing a paragraph to
     * it is not recoverable through the browser's undo once React has
     * re-rendered, and the prompt is the most expensive text here to retype.
     */
    const { field, onChange } = setup({ value: "a long prompt worth keeping" });
    field.focus();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(field);
  });

  it("hides Clear when there is nothing to clear", () => {
    setup({ value: "" });
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
  });

  it("clears a short prompt immediately", () => {
    const { onChange } = setup({ value: "red car" });
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("asks first before discarding substantial text", () => {
    const long = "a".repeat(200);
    const { onChange } = setup({ value: long });

    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
    // First click only arms it — nothing is lost yet.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /clear it\?/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /clear it\?/i }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});

describe("accessibility", () => {
  it("exposes a real textbox", () => {
    // Not a contenteditable div: screen readers, spellcheck, IME and the
    // browser's own undo all come free with the real control.
    const { field } = setup();
    expect(field.tagName).toBe("TEXTAREA");
  });

  it("marks itself invalid for assistive technology", () => {
    const { field } = setup({ invalid: true });
    expect(field.getAttribute("aria-invalid")).toBe("true");
  });

  it("links to its description when one is given", () => {
    const { field } = setup({ describedBy: "prompt-error" });
    expect(field.getAttribute("aria-describedby")).toBe("prompt-error");
  });

  it("keeps the shortcut target attribute the studio relies on", () => {
    // The `/` shortcut focuses `[data-studio-prompt]`. Losing it would break a
    // shortcut nothing else tests.
    const { field } = setup();
    expect(field.hasAttribute("data-studio-prompt")).toBe(true);
  });

  it("respects reduced motion on the focus transition", () => {
    const { container } = setup();
    const surface = container.querySelector(".rounded-xl");
    expect(surface?.className).toMatch(/motion-reduce:transition-none/);
  });
});

describe("the editor surface", () => {
  it("puts the focus ring on the container so the footer is inside it", () => {
    const { container } = setup();
    const surface = container.querySelector(".rounded-xl");
    expect(surface?.className).toMatch(/focus-within:ring-2/);
    expect(surface?.className).toMatch(/focus-within:border-brand/);
  });

  it("keeps controls out of the extension zone, below the text", () => {
    /**
     * The footer is a sibling of the textarea, not an absolutely positioned
     * overlay on it. Nothing of ours can therefore end up underneath a floating
     * button an extension drew in the bottom-right corner.
     */
    const { container, field } = setup({ value: "x" });
    const footer = screen.getByRole("button", { name: /expand/i })
      .parentElement!.parentElement!;
    expect(footer.contains(field)).toBe(false);
    expect(container.contains(footer)).toBe(true);
  });

  it("counts characters", () => {
    setup({ value: "12345" });
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("toggles the expanded editor without touching the text", () => {
    const { onChange } = setup({ value: "keep me" });
    const expand = screen.getByRole("button", { name: /expand/i });
    expect(expand.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(expand);
    expect(
      screen
        .getByRole("button", { name: /collapse/i })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders caller-supplied footer controls", () => {
    render(
      <PromptField
        value=""
        onChange={() => {}}
        modality="IMAGE"
        footer={<button type="button">Enhance</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Enhance" })).toBeTruthy();
  });
});

describe("browser-extension overlay tolerance", () => {
  it("keeps text readable when an overlay is injected into the corner", () => {
    /**
     * Simulates what a writing assistant does: appends a floating button
     * positioned at the bottom-right of the field. The assertion is that our
     * reserved gutter exists and that the injected node lands outside the text
     * flow rather than on top of a word.
     */
    const { container, field } = setup({ value: "una toma aérea del carro" });

    const overlay = document.createElement("div");
    overlay.setAttribute("data-extension", "writing-assistant");
    overlay.style.position = "absolute";
    overlay.style.right = "4px";
    overlay.style.bottom = "4px";
    container.querySelector(".rounded-xl")!.appendChild(overlay);

    // The gutter that keeps words clear of it.
    expect(field.className).toMatch(/pr-12/);
    // And the text itself is untouched by the injection.
    expect(field.value).toBe("una toma aérea del carro");
    expect(container.querySelector("[data-extension]")).not.toBeNull();
  });
});
