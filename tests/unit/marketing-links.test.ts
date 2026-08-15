import { describe, expect, it } from "vitest";

import { getCopy } from "@/features/marketing/i18n/dictionaries";
import { LOCALES } from "@/features/marketing/i18n/locales";

/**
 * Marketing calls to action must lead somewhere.
 *
 * Every auth entry point on the homepage — both header buttons and the hero's
 * primary CTA — pointed at `#pricing` for twenty-five sprints. They were
 * written in Sprint 2, before authentication existed, and nobody revisited them
 * when Clerk landed in Sprint 5. The result was a homepage with **no working
 * path to sign-up**: a visitor who decided to create an account was scrolled to
 * a price list instead.
 *
 * It survived that long because nothing about it fails. The anchor resolves,
 * the page scrolls, no error appears anywhere. Only a person actually trying to
 * sign up would notice, and the people testing the site already had accounts.
 *
 * So the guard is a test rather than a type: an href is a string, and no
 * compiler will ever object to the wrong one.
 */
/**
 * Section ids rendered by `Landing`, kept in step by hand.
 *
 * They live on the components rather than in one list, so there is nothing to
 * import. A stale entry here fails the test rather than shipping a dead
 * anchor, which is the right direction to be wrong in.
 */
const SECTION_IDS = [
  "demo",
  "showcase",
  "made",
  "gallery",
  "templates",
  "how-it-works",
  "features",
  "models",
  "pricing",
  "faq",
] as const;

describe("marketing calls to action", () => {
  for (const locale of LOCALES) {
    it(`sends the ${locale} hero CTA to a route, not an anchor`, () => {
      const { hero } = getCopy(locale);

      expect(
        hero.primaryCta.href.startsWith("#"),
        `hero primary CTA is "${hero.primaryCta.href}" — an anchor cannot start a sign-up`,
      ).toBe(false);

      expect(hero.primaryCta.href).toMatch(/^\/(sign-up|studio)/);
    });

    it(`keeps the ${locale} secondary CTA pointed at a real section`, () => {
      const { hero } = getCopy(locale);

      // The secondary CTA is *meant* to be an anchor — "explore creations",
      // not "start". What it must not be is an anchor to a section that does
      // not exist, which is a click that silently does nothing.
      //
      // Checked against SECTION_IDS rather than the nav: the nav became real
      // routes in this sprint and no longer registers which anchors exist.
      if (hero.secondaryCta.href.startsWith("#")) {
        expect(SECTION_IDS).toContain(hero.secondaryCta.href.slice(1));
      }
    });
  }
});
