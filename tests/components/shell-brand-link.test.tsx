import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "@/features/dashboard/components/app-shell";

/**
 * The dashboard and Studio brand mark, **rendered**.
 *
 * `tests/components/brand-link.test.tsx` proves the component and reads the
 * four call sites as source. That is not the same as proving the shell
 * actually mounts it: a source file can import `BrandLink`, pass it to a
 * prop, and have the receiving component drop the prop on the floor.
 *
 * Sprint 4.2's addendum reported that the deployed dashboard still did not go
 * home. The cause turned out to be that nothing had been deployed — the branch
 * was three commits ahead of the remote — but "the test passed and production
 * disagreed" is exactly the situation where a source-reading test is not
 * enough. So this renders `AppShell`, which is what `app/(app)/layout.tsx`
 * wraps every dashboard, Studio, projects and settings page in, and asserts on
 * the DOM.
 */

// The shell pulls in the notification bell, the credit pill and a Zustand
// store. None is what is under test; `next/navigation` is the only piece that
// needs a stand-in to render outside a router.
vi.mock("next/navigation", () => ({
  usePathname: () => "/studio",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// `UserButton` throws outside `ClerkProvider`. The provider is mounted in
// `app/(app)/layout.tsx` around this shell; standing it in here keeps the test
// about the brand link rather than about Clerk's initialisation.
vi.mock("@clerk/nextjs", () => ({
  UserButton: () => <div data-testid="user-button" />,
  useUser: () => ({ isSignedIn: true, user: null, isLoaded: true }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

function renderShell() {
  return render(
    <AppShell creditBalance={100} notifications={[]}>
      <p>page content</p>
    </AppShell>,
  );
}

describe("the shell renders a brand link home", () => {
  it("mounts it at least once", () => {
    renderShell();

    const links = screen.getAllByRole("link", { name: /home$/i });
    expect(links.length).toBeGreaterThan(0);
  });

  it("points every one of them at the public homepage", () => {
    // The desktop rail and the mobile drawer both receive the mark, so there
    // is more than one in the tree. Not one of them may go to /dashboard —
    // that is what it used to do, on the page it was rendered on.
    renderShell();

    for (const link of screen.getAllByRole("link", { name: /home$/i })) {
      expect(link.getAttribute("href")).toBe("/");
    }
  });

  it("puts it inside the desktop rail", () => {
    // `<aside>` is the persistent sidebar. Finding the link *there* is what
    // distinguishes "the shell renders it" from "something on the page does".
    const { container } = renderShell();

    const rail = container.querySelector("aside");
    expect(rail, "the desktop rail did not render").not.toBeNull();
    expect(
      within(rail as HTMLElement).getByRole("link", { name: /home$/i }),
    ).toBeDefined();
  });

  it("wraps it in nothing that could swallow the click", () => {
    /**
     * The addendum's specific worry: a parent click handler or a router push
     * intercepting the navigation.
     *
     * React attaches handlers at the root, so `onclick` is not readable from
     * the DOM. What *is* checkable is the shape — no ancestor may be a button,
     * a form, or an element with a role that implies its own activation
     * behaviour, because those are what would capture or preventDefault the
     * anchor.
     */
    const { container } = renderShell();

    const link = within(
      container.querySelector("aside") as HTMLElement,
    ).getByRole("link", { name: /home$/i });

    for (let node = link.parentElement; node; node = node.parentElement) {
      expect(node.tagName).not.toBe("BUTTON");
      expect(node.tagName).not.toBe("FORM");
      expect(node.tagName).not.toBe("A");
      expect(["button", "link", "menuitem"]).not.toContain(
        node.getAttribute("role"),
      );
    }

    // And the anchor itself is a real navigation, not a scripted one.
    expect(link.getAttribute("href")).toBe("/");
    expect(link.getAttribute("target")).toBeNull();
  });

  it("keeps its accessible name when the wordmark is hidden", () => {
    // The collapsed rail drops the visible text. The name must survive, or the
    // one control a screen-reader user relies on becomes an unlabelled icon.
    renderShell();

    for (const link of screen.getAllByRole("link", { name: /home$/i })) {
      expect(link.getAttribute("aria-label")).toMatch(/home$/i);
    }
  });
});
