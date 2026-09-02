import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HeroVideo } from "@/features/marketing/components/hero-video";

/**
 * The hero says it is AI-generated even when there is no video.
 *
 * ## The two bugs this exists for, both found on the deployed page
 *
 * **The label was conditional.** It lived inside `{showVideo ? … : null}`, and
 * `showVideo` starts false so the server and client markup agree — so the
 * server-rendered HTML carried no label at all. "AI-generated" appeared zero
 * times in the production response body. Anyone who never reaches the video
 * branch saw a generated still with nothing saying so: JavaScript off,
 * `prefers-reduced-motion`, Save-Data, a 2G-class connection, a phone, or
 * low-end hardware. That is most of the ways a disclosure gets seen, by the
 * people most likely to need it.
 *
 * **It was inside an `aria-hidden` subtree.** The decorative wrapper carries
 * `aria-hidden`, and the row set `aria-hidden={false}` with a comment claiming
 * that cleared it. It does not — `aria-hidden` on an ancestor removes the whole
 * subtree from the accessibility tree and a descendant cannot opt back in. The
 * disclosure and both controls were visible and entirely unannounced.
 *
 * ## Why the poster-only case is the one asserted
 *
 * It is the case that was broken, and the harder one to notice: on a
 * developer's desktop the video always plays, so the label is always there.
 * jsdom reports no connection, no hardware concurrency and a zero-width
 * window, so `shouldPlayVideo` refuses — which is exactly the environment that
 * needed testing.
 *
 * Queries are by role and by accessible text throughout, so a regression that
 * hides the row from assistive technology fails here rather than passing on a
 * DOM lookup that does not care.
 */
describe("the hero discloses what it is showing", () => {
  it("labels the poster as generated when no video plays", () => {
    render(<HeroVideo />);

    expect(screen.queryByText(/AI-generated/)).not.toBeNull();
  });

  it("calls a still a still", () => {
    // Calling a poster a video is the small inaccuracy that makes the rest of
    // the sentence worth doubting.
    render(<HeroVideo />);

    expect(screen.queryByText(/AI-generated image/)).not.toBeNull();
    expect(screen.queryByText(/AI-generated video/)).toBeNull();
  });

  it("offers the full account, not just the label", () => {
    render(<HeroVideo />);

    const link = screen.getByRole("link", { name: /content details/i });
    expect(link.getAttribute("href")).toBe("/content-details");
  });

  it("shows no playback controls when there is nothing to control", () => {
    // A Pause button over a still image is a lie, so the controls stay
    // conditional even though the disclosure no longer is.
    render(<HeroVideo />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("keeps the disclosure out of the decorative aria-hidden layer", () => {
    /**
     * The regression guard for the second bug. Walking ancestors is the only
     * way to see it: the element is in the DOM either way, and `aria-hidden`
     * sits on a parent several levels up.
     */
    const { container } = render(<HeroVideo />);
    const label = screen.getByText(/AI-generated/);

    let node: HTMLElement | null = label;
    while (node && node !== container) {
      expect(
        node.getAttribute("aria-hidden"),
        `${node.tagName.toLowerCase()} hides the disclosure from screen readers`,
      ).not.toBe("true");
      node = node.parentElement;
    }
  });

  it("still hides the decoration itself", () => {
    // The poster and the scrims are decoration and must stay hidden; moving the
    // disclosure out must not have taken the wrapper's `aria-hidden` with it.
    const { container } = render(<HeroVideo />);

    expect(
      container.querySelector('[aria-hidden="true"] .hero-poster'),
    ).not.toBeNull();
  });
});
