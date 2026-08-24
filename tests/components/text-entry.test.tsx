import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Field, InputField, SearchInput } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

/**
 * The shared text-entry standard.
 *
 * ## Why these are class assertions
 *
 * jsdom computes no layout, so a test cannot measure that text clears a border.
 * What it *can* do is prove the field carries the padding that produces it, and
 * that a caller's override has not quietly removed it — which is the failure
 * that actually happened: the studio prompt shipped with `padding-left: 0` while
 * its class string still read `px-[18px]`, because a `px` shorthand and a `pr`
 * longhand were fighting and a test asserting the string passed anyway.
 *
 * So these check the *resolved* class list after `cn()` and tailwind-merge have
 * run, which is the thing the browser sees.
 */

/** The multiline standard, in one place, so a drift shows up as one failure. */
const MULTILINE = {
  paddingTop: /(^|\s)pt-4(\s|$)/,
  paddingBottom: /(^|\s)pb-4(\s|$)/,
  paddingLeft: /pl-\[18px\]/,
  paddingRight: /pr-\[18px\]/,
  /** 56px, the writing-assistant lane. */
  overlayRight: /(^|\s)pr-16(\s|$)/,
  /** 58px, room for footer controls. */
  overlayBottom: /pb-\[58px\]/,
  lineHeight: /leading-\[1\.6\]/,
};

function classesOf(testId: string): string {
  return screen.getByTestId(testId).className;
}

describe("1. shared multiline fields carry the professional spacing", () => {
  it("pads 16px top and bottom, 18px left and right", () => {
    render(<Textarea data-testid="t" aria-label="Notes" />);
    const cls = classesOf("t");
    expect(cls).toMatch(MULTILINE.paddingTop);
    expect(cls).toMatch(MULTILINE.paddingBottom);
    expect(cls).toMatch(MULTILINE.paddingLeft);
    expect(cls).toMatch(MULTILINE.paddingRight);
  });

  it("sets a line height inside the readable band", () => {
    // 1.6, between the 1.55 and 1.65 the standard allows. Tailwind's own
    // `text-sm` would be 1.43 — below it, and prose set that tight reads as a
    // wall rather than paragraphs.
    render(<Textarea data-testid="lh" aria-label="Notes" />);
    expect(classesOf("lh")).toMatch(MULTILINE.lineHeight);
  });

  it("names each padding side rather than using a shorthand", () => {
    /**
     * The specific regression. `px-[18px]` plus `pr-12` resolved to
     * `padding-left: 0` in the browser while the class string looked correct.
     */
    render(<Textarea data-testid="sides" aria-label="Notes" />);
    expect(classesOf("sides")).not.toMatch(/(^|\s)px-/);
    expect(classesOf("sides")).not.toMatch(/(^|\s)py-/);
  });

  it("keeps a floor and a ceiling on height", () => {
    render(<Textarea data-testid="h" aria-label="Notes" />);
    const cls = classesOf("h");
    expect(cls).toMatch(/min-h-24/);
    // Past this it scrolls internally instead of pushing the submit button off
    // the bottom of the screen.
    expect(cls).toMatch(/max-h-\[420px\]/);
  });
});

describe("2. overlay controls reserve their own space", () => {
  it("reserves 56px on the right for a writing-assistant button", () => {
    render(<Textarea data-testid="o" aria-label="Prompt" overlayRight />);
    expect(classesOf("o")).toMatch(MULTILINE.overlayRight);
    // And the normal right padding is gone rather than both being present.
    expect(classesOf("o")).not.toMatch(MULTILINE.paddingRight);
  });

  it("reserves 58px at the bottom for footer controls", () => {
    render(<Textarea data-testid="b" aria-label="Prompt" overlayBottom />);
    expect(classesOf("b")).toMatch(MULTILINE.overlayBottom);
    expect(classesOf("b")).not.toMatch(MULTILINE.paddingBottom);
  });

  it("reserves neither by default", () => {
    render(<Textarea data-testid="p" aria-label="Notes" />);
    expect(classesOf("p")).not.toMatch(MULTILINE.overlayRight);
    expect(classesOf("p")).not.toMatch(MULTILINE.overlayBottom);
  });

  it("can reserve both at once", () => {
    render(
      <Textarea
        data-testid="both"
        aria-label="Prompt"
        overlayRight
        overlayBottom
      />,
    );
    expect(classesOf("both")).toMatch(MULTILINE.overlayRight);
    expect(classesOf("both")).toMatch(MULTILINE.overlayBottom);
  });
});

describe("3. single-line fields reserve space for their icons", () => {
  it("pads 36px where a leading adornment sits", () => {
    // The icon starts at 12px and is 16px wide, so 36px leaves 8px before the
    // first character. Less and the glyph sits on the text.
    render(
      <InputField
        data-testid="l"
        aria-label="Email"
        leading={<span>@</span>}
      />,
    );
    expect(classesOf("l")).toMatch(/(^|\s)pl-9(\s|$)/);
  });

  it("pads 36px where a trailing adornment sits", () => {
    render(
      <InputField
        data-testid="tr"
        aria-label="Password"
        trailing={<span>x</span>}
      />,
    );
    expect(classesOf("tr")).toMatch(/(^|\s)pr-9(\s|$)/);
  });

  it("keeps 12px of horizontal padding with no adornments", () => {
    render(<InputField data-testid="plain" aria-label="Name" />);
    expect(classesOf("plain")).toMatch(/(^|\s)px-3(\s|$)/);
  });

  it("uses 16px text on mobile so iOS does not zoom on focus", () => {
    render(<InputField data-testid="z" aria-label="Name" />);
    expect(classesOf("z")).toMatch(/text-base/);
    expect(classesOf("z")).toMatch(/sm:text-sm/);
  });
});

describe("4. long text wraps rather than scrolling sideways", () => {
  it("breaks anywhere and preserves typed line breaks", () => {
    render(<Textarea data-testid="w" aria-label="Notes" />);
    const cls = classesOf("w");
    // A pasted URL with no spaces would otherwise force a horizontal scrollbar.
    expect(cls).toMatch(/\[overflow-wrap:anywhere\]/);
    // Blank paragraphs and indentation survive.
    expect(cls).toMatch(/whitespace-pre-wrap/);
  });
});

describe("5. the field never edits what was typed", () => {
  it("returns the value byte for byte, including blank lines", () => {
    /**
     * The most important test in this file. Everything else here is spacing;
     * this is the guarantee that a presentation change did not touch content.
     */
    const typed =
      "Línea uno\n\nLínea tres con acentos: ñ á é\n\thttps://example.test/a?b=1&c=2\n   trailing spaces   ";
    const onChange = vi.fn();
    render(
      <Textarea data-testid="v" aria-label="Prompt" onChange={onChange} />,
    );

    const field = screen.getByTestId("v") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: typed } });

    expect(onChange).toHaveBeenCalled();
    expect(field.value).toBe(typed);
    expect(field.value.length).toBe(typed.length);
  });

  it("does not trim, collapse or normalise whitespace", () => {
    const typed = "  leading and trailing  \n\n\n";
    render(<Textarea data-testid="ws" aria-label="Prompt" />);
    const field = screen.getByTestId("ws") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: typed } });
    expect(field.value).toBe(typed);
  });
});

describe("6. empty, short and long content all render", () => {
  it("renders empty with a placeholder", () => {
    render(
      <Textarea
        data-testid="e"
        aria-label="Notes"
        placeholder="Say something"
      />,
    );
    expect((screen.getByTestId("e") as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByPlaceholderText("Say something")).toBeTruthy();
  });

  it("renders a single short line", () => {
    render(<Textarea data-testid="s" aria-label="Notes" defaultValue="Hi" />);
    expect((screen.getByTestId("s") as HTMLTextAreaElement).value).toBe("Hi");
  });

  it("renders a long multi-paragraph value unchanged", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}.`).join(
      "\n\n",
    );
    render(
      <Textarea data-testid="lg" aria-label="Notes" defaultValue={long} />,
    );
    expect((screen.getByTestId("lg") as HTMLTextAreaElement).value).toBe(long);
  });
});

describe("7. state variants render", () => {
  it("marks an invalid field for assistive technology and for CSS", () => {
    render(<Textarea data-testid="inv" aria-label="Notes" invalid />);
    expect(screen.getByTestId("inv").getAttribute("aria-invalid")).toBe("true");
    expect(classesOf("inv")).toMatch(/aria-invalid:border-destructive/);
  });

  it("disables without hiding the text", () => {
    render(
      <Textarea
        data-testid="d"
        aria-label="Notes"
        disabled
        defaultValue="kept"
      />,
    );
    const field = screen.getByTestId("d") as HTMLTextAreaElement;
    expect(field.disabled).toBe(true);
    expect(field.value).toBe("kept");
    expect(classesOf("d")).toMatch(/disabled:cursor-not-allowed/);
  });

  it("supports read-only distinctly from disabled", () => {
    // Read-only text must stay selectable and legible; disabled is dimmed.
    render(
      <Textarea
        data-testid="ro"
        aria-label="Notes"
        readOnly
        defaultValue="fixed"
      />,
    );
    const field = screen.getByTestId("ro") as HTMLTextAreaElement;
    expect(field.readOnly).toBe(true);
    expect(field.disabled).toBe(false);
    expect(classesOf("ro")).toMatch(/read-only:cursor-default/);
  });

  it("has a focus ring that does not change the box size", () => {
    // A ring rather than a border-width change: growing the border on focus
    // shifts every neighbour by a pixel.
    render(<Textarea data-testid="f" aria-label="Notes" />);
    expect(classesOf("f")).toMatch(/focus-visible:ring-2/);
    expect(classesOf("f")).toMatch(/focus-visible:ring-ring\/40/);
    expect(classesOf("f")).not.toMatch(/focus-visible:ring-white/);
  });

  it("gives single-line fields the same states", () => {
    render(<InputField data-testid="i" aria-label="Name" readOnly />);
    expect(classesOf("i")).toMatch(/read-only:cursor-default/);
    expect(classesOf("i")).toMatch(/aria-invalid:border-destructive/);
    expect(classesOf("i")).toMatch(/focus-visible:ring-2/);
  });
});

describe("9. general forms use the shared primitives", () => {
  it("wires label, hint and error to the control", () => {
    render(
      <Field label="Display name" hint="Shown on your profile">
        {(props) => <InputField {...props} data-testid="named" />}
      </Field>,
    );
    const field = screen.getByTestId("named");
    expect(screen.getByLabelText("Display name")).toBe(field);
    expect(field.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("announces an error and drops the hint", () => {
    render(
      <Field
        label="Email"
        hint="We never share it"
        error="That address is not valid"
      >
        {(props) => <InputField {...props} data-testid="bad" />}
      </Field>,
    );
    expect(screen.getByRole("alert").textContent).toContain("not valid");
    expect(screen.queryByText("We never share it")).toBeNull();
    expect(screen.getByTestId("bad").getAttribute("aria-invalid")).toBe("true");
  });
});

describe("the shared search field", () => {
  it("carries a search type and its icon padding", () => {
    render(
      <SearchInput
        data-testid="q"
        aria-label="Search"
        value=""
        onChange={() => {}}
      />,
    );
    const field = screen.getByTestId("q") as HTMLInputElement;
    expect(field.type).toBe("search");
    expect(field.className).toMatch(/(^|\s)pl-9(\s|$)/);
  });

  it("offers no clear button when there is nothing to clear", () => {
    render(
      <SearchInput
        aria-label="Search"
        value=""
        onChange={() => {}}
        onClear={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  it("clears through a keyboard-reachable button", () => {
    // A clear affordance only a mouse can reach is not a clear affordance.
    const onClear = vi.fn();
    render(
      <SearchInput
        aria-label="Search"
        value="ocean"
        onChange={() => {}}
        onClear={onClear}
      />,
    );
    const button = screen.getByRole("button", { name: "Clear search" });
    fireEvent.click(button);
    expect(onClear).toHaveBeenCalled();
  });

  it("suppresses the browser's own clear button so the two do not overlap", () => {
    render(
      <SearchInput
        data-testid="wk"
        aria-label="Search"
        value="x"
        onChange={() => {}}
      />,
    );
    expect(classesOf("wk")).toMatch(/webkit-search-cancel-button/);
  });
});

describe("an accidental zero cannot silently remove the padding", () => {
  /**
   * The production defect, in the smallest form that reproduces it.
   *
   * The homepage composer passed `px-0`. tailwind-merge did exactly its job —
   * the later class won — and the deployed field rendered `padding-left: 0px`
   * with the first character against the border. Every jsdom assertion passed,
   * because a class string is not a computed style.
   *
   * This locks the *resolved* class list; `tests/e2e/prompt-padding.spec.ts`
   * measures the real thing in Chromium. Both are needed — one catches the
   * mistake in review, the other catches it in the browser.
   */
  for (const killer of ["p-0", "px-0", "pl-0"] as const) {
    it(`loses the left padding when a caller passes ${killer}`, () => {
      render(
        <Textarea
          data-testid={killer}
          aria-label="Prompt"
          className={killer}
        />,
      );
      const cls = classesOf(killer);
      // Documented, not tolerated: the override wins, and the standard is gone.
      // A reviewer seeing this test knows the class is load-bearing.
      expect(cls).toContain(killer);
      expect(cls).not.toMatch(MULTILINE.paddingLeft);
    });
  }

  it("keeps the standard when nothing overrides it", () => {
    render(<Textarea data-testid="std" aria-label="Prompt" />);
    const cls = classesOf("std");
    for (const killer of ["p-0", "px-0", "pl-0", "py-0"]) {
      expect(cls.split(" ")).not.toContain(killer);
    }
    expect(cls).toMatch(MULTILINE.paddingLeft);
  });

  it("reserves 64px for the assistant lane, not 56", () => {
    // Raised after measuring in Chromium: 56px cleared the badge but left the
    // caret underneath it at the end of a long line.
    render(<Textarea data-testid="lane" aria-label="Prompt" overlayRight />);
    expect(classesOf("lane")).toContain("pr-16");
  });

  it("hides horizontal overflow so a wrap bug cannot scroll the text", () => {
    render(<Textarea data-testid="ox" aria-label="Prompt" />);
    expect(classesOf("ox")).toMatch(/overflow-x-hidden/);
    // `toContain`, not a regex: the class is `[word-break:normal]`, and the
    // brackets make an unescaped pattern an invalid character class.
    expect(classesOf("ox")).toContain("[word-break:normal]");
  });
});
describe("12. documented exceptions are explicit", () => {
  it("lets a caller opt out of the shared padding deliberately", () => {
    /**
     * An escape hatch that has to be written on purpose. The homepage composer
     * once carried `px-0` — an accidental exception nobody had decided on, which
     * put the first character of every prompt against the card edge. A caller
     * can still override, but the override is visible in the class list and a
     * grep for it finds every one.
     */
    render(<Textarea data-testid="x" aria-label="Notes" className="pl-0" />);
    expect(classesOf("x")).toMatch(/(^|\s)pl-0(\s|$)/);
    expect(classesOf("x")).not.toMatch(MULTILINE.paddingLeft);
    // The other three sides survive an override of one.
    expect(classesOf("x")).toMatch(MULTILINE.paddingTop);
    expect(classesOf("x")).toMatch(MULTILINE.paddingRight);
  });
});
