import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Heading } from "@/components/ui/typography";

/**
 * `Heading` separates **size** from **level**, and that split is the reason
 * three real accessibility bugs were found in Sprint 13 — including two `h1`s
 * on the design-system page, in the very section arguing against choosing a
 * heading level for its appearance.
 *
 * These assert the contract that prevents a fourth.
 */
describe("Heading", () => {
  it("renders the semantic level it is given", () => {
    render(<Heading as="h2">Section</Heading>);
    expect(screen.getByRole("heading", { level: 2 })).toBeDefined();
  });

  it("renders a paragraph when asked to, so text can look like a heading without being one", () => {
    // The escape hatch added in Sprint 13. Without it, the only way to get the
    // visual size was to misuse a heading tag — which is exactly the bug.
    render(<Heading as="p">Looks big, is not a heading</Heading>);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("Looks big, is not a heading").tagName).toBe("P");
  });

  it("keeps size independent of level", () => {
    const { container: big } = render(
      <Heading as="h4" size="h1">
        Small level, large text
      </Heading>,
    );
    const heading = big.querySelector("h4");
    expect(heading).not.toBeNull();
    // The level is h4 regardless of how large it renders.
    expect(heading?.tagName).toBe("H4");
  });

  it("passes through arbitrary props", () => {
    render(
      <Heading as="h3" id="anchor-target">
        Linkable
      </Heading>,
    );
    expect(screen.getByRole("heading", { level: 3 }).id).toBe("anchor-target");
  });

  it("renders visually-hidden headings that are still in the accessibility tree", () => {
    // `/studio` and `/p/[slug]` both use `sr-only` headings because the image
    // is the headline. They must remain real headings for screen readers.
    render(
      <Heading as="h1" className="sr-only">
        AI Studio
      </Heading>,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "AI Studio" }),
    ).toBeDefined();
  });
});
