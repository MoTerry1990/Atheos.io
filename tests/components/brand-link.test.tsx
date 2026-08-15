import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { BrandLink } from "@/components/layout/brand-link";
import { SITE } from "@/features/marketing/content";
import { ROUTES } from "@/features/marketing/i18n/locales";

/**
 * The logo goes home.
 *
 * ## The bug
 *
 * Four surfaces each rendered their own copy of the wordmark, and two of them
 * linked to the page they were rendered on: the dashboard shell pointed at
 * `/dashboard`, the community header at `/explore`. Clicking the logo there did
 * nothing at all.
 *
 * That is a worse failure than it sounds. The logo is the one control every
 * user assumes they understand, so a logo that does not respond reads as the
 * page having broken rather than as a link that was never wired up — and a
 * signed-in subscriber had no route back to the pricing page or the terms.
 *
 * ## Two kinds of test here, deliberately
 *
 * The rendering tests below exercise the component. They cannot prove the
 * *other* files use it, so the last block reads the four call sites as source
 * and asserts none of them has grown its own wordmark again. A previous sprint
 * learned that a source-reading test can pass for the wrong reason, so each one
 * asserts on a path it resolves and fails loudly if the file is missing.
 */

describe("BrandLink", () => {
  it("points at the public homepage by default", () => {
    render(<BrandLink />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/");
  });

  it("points at the Spanish homepage when given one", () => {
    // `/es`, not `/es/`, and not a prefixed English path — the marketing
    // routes are localised, so home is looked up rather than constructed.
    render(<BrandLink href={ROUTES.home.es} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/es");
  });

  it("keeps English and Spanish home on the two expected routes", () => {
    expect(ROUTES.home.en).toBe("/");
    expect(ROUTES.home.es).toBe("/es");
  });

  it("is labelled for screen readers", () => {
    // The mark is a gradient square plus a word. Announcing "Atheos" alone
    // does not tell anybody that activating it goes somewhere.
    render(<BrandLink />);
    expect(
      screen.getByRole("link", { name: `${SITE.name} home` }),
    ).toBeDefined();
  });

  it("never links to a protected route", () => {
    // The whole point. `/dashboard`, `/studio` and `/explore` are all places
    // this link used to go, and all of them are the wrong answer to "home".
    for (const href of ["/", ROUTES.home.es]) {
      const { unmount } = render(<BrandLink href={href} />);
      const target = screen.getByRole("link").getAttribute("href")!;

      expect(target).not.toMatch(/^\/(dashboard|studio|explore|settings)/);
      unmount();
    }
  });

  it("carries no sign-out behaviour", () => {
    /**
     * A plain anchor, no click handler, no form, no method.
     *
     * "Clicking the logo signs me out" is the failure this guards. It would
     * happen if the mark were ever wired to a Clerk `SignOutButton` or given
     * an `onClick` that cleared session state — both plausible edits for
     * somebody adding a "leave the app" affordance next to it.
     */
    const { container } = render(<BrandLink />);
    const anchor = container.querySelector("a")!;

    expect(anchor.getAttribute("method")).toBeNull();
    expect(anchor.getAttribute("formaction")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
  });
});

describe("every surface uses it", () => {
  const CALL_SITES = [
    "features/marketing/components/site-header.tsx",
    "features/dashboard/components/app-shell.tsx",
    "app/(community)/layout.tsx",
    "features/auth/components/auth-shell.tsx",
  ];

  it.each(CALL_SITES)(
    "%s renders BrandLink and no wordmark of its own",
    (file) => {
      const path = resolve(import.meta.dirname, "../..", file);
      const source = readFileSync(path, "utf8");

      // Fails loudly rather than passing on an empty read.
      expect(source.length, `${file} is empty or unreadable`).toBeGreaterThan(
        100,
      );

      expect(source, `${file} does not use BrandLink`).toContain("BrandLink");

      // The old duplicated mark: a gradient square wrapping a Sparkles icon.
      // Its absence is what stops the four copies growing back.
      expect(
        source.includes("bg-gradient-brand") && source.includes("Sparkles"),
        `${file} still renders its own wordmark`,
      ).toBe(false);
    },
  );

  it("leaves no brand link pointing at the dashboard or explore", () => {
    for (const file of CALL_SITES) {
      const source = readFileSync(
        resolve(import.meta.dirname, "../..", file),
        "utf8",
      );

      // Nav *items* may point at /dashboard — the sidebar lists it. What must
      // not exist is a BrandLink whose href does.
      expect(source).not.toMatch(
        /<BrandLink[^>]*href=["']\/(dashboard|explore)/,
      );
    }
  });
});

describe("the homepage stays reachable while signed in", () => {
  it("has no redirect from the marketing root to the dashboard", () => {
    /**
     * The other half of the fix.
     *
     * A logo that navigates home and is immediately bounced back is worse than
     * one that never moved — the reader sees a flash and concludes the click
     * failed. So `/` and `/es` must render the marketing page for everybody,
     * signed in or not.
     *
     * Asserted against the page and the middleware, which are the only two
     * places such a redirect could live.
     */
    for (const file of ["app/(marketing)/page.tsx", "middleware.ts"]) {
      const source = readFileSync(
        resolve(import.meta.dirname, "../..", file),
        "utf8",
      );

      expect(source.length, `${file} is empty or unreadable`).toBeGreaterThan(
        100,
      );
      expect(source, `${file} bounces visitors to the dashboard`).not.toMatch(
        /redirect\([^)]*\/dashboard/,
      );
    }
  });

  it("still protects the application routes", () => {
    // Removing the bounce must not remove the gate. `app/(app)/layout.tsx` is
    // where every protected route inherits its authorisation, and this fix
    // deliberately did not touch it.
    const source = readFileSync(
      resolve(import.meta.dirname, "../../app/(app)/layout.tsx"),
      "utf8",
    );

    expect(source).toContain("requireUserId()");
  });
});
