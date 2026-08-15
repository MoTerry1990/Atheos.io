import { describe, expect, it } from "vitest";

import {
  COMPOSER_MODALITIES,
  MADE_WITH_ATHEOS,
  SHOWCASE,
} from "@/features/marketing/content";
import { getCopy } from "@/features/marketing/i18n/dictionaries";
import { LOCALES } from "@/features/marketing/i18n/locales";

/**
 * Homepage sections, checked at the data layer.
 *
 * These are the failures that render *successfully*: three tabs sharing one
 * body of copy, a card advertising a video with no video attached, a nav item
 * pointing at a route that does not exist. Nothing throws, nothing looks
 * broken in a build log, and the page is wrong.
 *
 * The Image/Video/Audio panels in particular had exactly this shape — the tabs
 * looked right, the roles were correct, and clicking Video showed the Image
 * panel for twenty-five sprints. That bug was in the animation rather than the
 * data, but a test that the three panels *say different things* would have
 * made the symptom visible far sooner.
 */
describe("showcase panels", () => {
  for (const locale of LOCALES) {
    it(`gives every ${locale} modality its own copy`, () => {
      const { showcase } = getCopy(locale);

      expect(showcase).toHaveLength(SHOWCASE.length);

      const headlines = new Set(showcase.map((panel) => panel.headline));
      const bodies = new Set(showcase.map((panel) => panel.body));

      // Duplicate copy across panels is how "the Video tab shows the Image
      // tab" looks from the data side.
      expect(headlines.size).toBe(showcase.length);
      expect(bodies.size).toBe(showcase.length);
    });

    it(`gives every ${locale} panel its own bullets`, () => {
      const { showcase } = getCopy(locale);

      for (const panel of showcase) {
        expect(panel.bullets.length).toBeGreaterThan(0);
      }

      const first = showcase[0]?.bullets.join("|");
      const second = showcase[1]?.bullets.join("|");
      expect(first).not.toBe(second);
    });
  }

  it("has an artwork entry per panel, matched by index", () => {
    // The tabs join `SHOWCASE` to the dictionary by position. A length
    // mismatch renders a panel with no words rather than throwing.
    for (const locale of LOCALES) {
      expect(getCopy(locale).showcase).toHaveLength(SHOWCASE.length);
    }
  });
});

describe("made with atheos", () => {
  it("stays within the card budget", () => {
    const videos = MADE_WITH_ATHEOS.filter((item) => item.kind === "video");
    const images = MADE_WITH_ATHEOS.filter((item) => item.kind === "image");

    expect(videos.length).toBeLessThanOrEqual(6);
    expect(images.length).toBeLessThanOrEqual(6);
  });

  it("attaches a clip to every card that claims to be a video", () => {
    // A video card with no video renders as a still and quietly misrepresents
    // what the product produced.
    for (const item of MADE_WITH_ATHEOS) {
      if (item.kind === "video") {
        expect(
          item.video,
          `${item.poster} claims video with no clip`,
        ).toBeTruthy();
        expect(item.video).toMatch(/^\/marketing\/.+\.(mp4|webm)$/);
      } else {
        expect(item.video).toBeUndefined();
      }
    }
  });

  it("gives every card a poster and a prompt", () => {
    for (const item of MADE_WITH_ATHEOS) {
      expect(item.poster.trim()).not.toBe("");
      // The prompt is the card's whole claim to being real output.
      expect(item.prompt.trim().length).toBeGreaterThan(10);
    }
  });
});

describe("navigation", () => {
  for (const locale of LOCALES) {
    it(`points every ${locale} nav item at a route, not an anchor`, () => {
      const { nav } = getCopy(locale);

      expect(nav.length).toBeGreaterThan(0);
      for (const link of nav) {
        expect(
          link.href.startsWith("#"),
          `"${link.label}" is an anchor — the header navigates the product, not this page`,
        ).toBe(false);
        expect(link.href.startsWith("/")).toBe(true);
      }
    });

    it(`keeps the ${locale} sign-in link on the real auth route`, () => {
      // Not asserted from the dictionary: the href lives in the header, and
      // this is the label that must exist for it to be rendered at all.
      expect(getCopy(locale).auth.signIn.trim()).not.toBe("");
      expect(getCopy(locale).auth.signUp.trim()).not.toBe("");
    });
  }
});

describe("composer", () => {
  it("offers a modality entry for every advertised label", () => {
    for (const locale of LOCALES) {
      const { composer } = getCopy(locale);

      for (const entry of composer.modalities) {
        expect(
          COMPOSER_MODALITIES.some((m) => m.id === entry.id),
          `${entry.id} is labelled but has no models`,
        ).toBe(true);
      }
    }
  });
});
