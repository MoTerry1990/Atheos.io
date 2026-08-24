import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Prompt padding, measured in a real browser.
 *
 * ## Why this exists after a jsdom suite already "covered" it
 *
 * The spacing standard was asserted by reading class strings. Those assertions
 * passed while the deployed homepage rendered `padding-left: 0px` — the first
 * character sat against the border, and the class list showed exactly why:
 * `px-0` from the call site, correctly beating the base `px-3`.
 *
 * A class name is not a computed style. jsdom cannot tell the difference,
 * because jsdom computes no layout at all. So these read `getComputedStyle()`
 * off the actual editable element in Chromium, against a production build.
 *
 * By default `playwright.config.ts` builds and serves the app on :3210. Point
 * `E2E_BASE_URL` at the live deployment to run the same assertions against
 * production — which is how this was proven broken before it was fixed.
 */

/** The measurable contract, in one place. */
const MULTILINE = {
  paddingLeftMin: 16,
  paddingTopMin: 14,
  paddingRightMin: 18,
  paddingBottomMin: 16,
  fontSizeMin: 14,
  lineHeightRatioMin: 1.5,
};

const SINGLE_LINE = { paddingXMin: 12, heightMin: 40 };

interface Box {
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  fontSize: number;
  lineHeight: number;
  borderLeft: number;
  textIndent: number;
  boxSizing: string;
  overflowX: string;
  overflowY: string;
  overflowWrap: string;
  wordBreak: string;
  whiteSpace: string;
  height: number;
  className: string;
}

/** Computed style of the *editable element itself*, never a wrapper. */
async function measure(el: Locator): Promise<Box> {
  return el.evaluate((node) => {
    const cs = getComputedStyle(node as HTMLElement);
    const px = (v: string) => parseFloat(v) || 0;
    return {
      paddingTop: px(cs.paddingTop),
      paddingRight: px(cs.paddingRight),
      paddingBottom: px(cs.paddingBottom),
      paddingLeft: px(cs.paddingLeft),
      fontSize: px(cs.fontSize),
      // `normal` has no number; resolve it the way the browser lays it out.
      lineHeight:
        cs.lineHeight === "normal" ? px(cs.fontSize) * 1.2 : px(cs.lineHeight),
      borderLeft: px(cs.borderLeftWidth),
      textIndent: px(cs.textIndent),
      boxSizing: cs.boxSizing,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      overflowWrap: cs.overflowWrap,
      wordBreak: cs.wordBreak,
      whiteSpace: cs.whiteSpace,
      height: (node as HTMLElement).getBoundingClientRect().height,
      className: (node as HTMLElement).className,
    };
  });
}

/** Assert the multiline contract against one editable element. */
function assertMultiline(box: Box, options: { overlayRight?: boolean } = {}) {
  // The headline. `padding-left: 0` is the bug this file exists for.
  expect(box.paddingLeft, "padding-left").toBeGreaterThanOrEqual(
    MULTILINE.paddingLeftMin,
  );
  expect(box.paddingTop, "padding-top").toBeGreaterThanOrEqual(
    MULTILINE.paddingTopMin,
  );
  expect(box.paddingBottom, "padding-bottom").toBeGreaterThanOrEqual(
    MULTILINE.paddingBottomMin,
  );
  expect(
    box.paddingRight,
    options.overlayRight ? "padding-right with overlay" : "padding-right",
  ).toBeGreaterThanOrEqual(
    options.overlayRight ? 64 : MULTILINE.paddingRightMin,
  );

  expect(box.fontSize, "font-size").toBeGreaterThanOrEqual(
    MULTILINE.fontSizeMin,
  );
  expect(
    box.lineHeight / box.fontSize,
    "line-height ratio",
  ).toBeGreaterThanOrEqual(MULTILINE.lineHeightRatioMin);

  // A text-indent would offset the first line only — a rendering fault, not a
  // style. Padding is the whole mechanism.
  expect(box.textIndent, "text-indent").toBe(0);
  expect(box.boxSizing, "box-sizing").toBe("border-box");
  expect(box.overflowX, "overflow-x").toBe("hidden");
  expect(box.whiteSpace, "white-space").toContain("pre");
  expect(box.wordBreak, "word-break").toBe("normal");

  // The number a person actually sees: how far the first glyph sits from the
  // inner edge of the border.
  expect(
    box.paddingLeft + box.borderLeft,
    "first character inset from inner left edge",
  ).toBeGreaterThanOrEqual(16);
}

async function homepagePrompt(page: Page, mode: "Image" | "Video" | "Audio") {
  await page.goto("/");
  const tab = page.getByRole("tab", { name: mode });
  if (await tab.count()) await tab.first().click();
  return page.locator("textarea").first();
}

test.describe("homepage prompt padding", () => {
  for (const mode of ["Image", "Video", "Audio"] as const) {
    test(`${mode} prompt keeps text off the border`, async ({ page }) => {
      const field = await homepagePrompt(page, mode);
      await expect(field).toBeVisible();

      await field.click();
      await field.fill("Atheos padding test");

      const box = await measure(field);
      assertMultiline(box);

      // The exact regression: a call site passing px-0 / pl-0 and winning.
      expect(box.className).not.toMatch(/(^|\s)(p-0|px-0|pl-0|py-0)(\s|$)/);
    });
  }

  test("placeholder starts where typed text starts", async ({ page }) => {
    /**
     * Measured rather than assumed: a placeholder positioned by a different
     * rule is a visible jump the moment somebody types their first character.
     */
    const field = await homepagePrompt(page, "Image");
    const empty = await measure(field);

    await field.click();
    await field.fill("Atheos padding test");
    const filled = await measure(field);

    expect(filled.paddingLeft).toBe(empty.paddingLeft);
    expect(filled.paddingTop).toBe(empty.paddingTop);
  });

  test("a long multi-paragraph prompt wraps without scrolling sideways", async ({
    page,
  }) => {
    const field = await homepagePrompt(page, "Image");
    const long = [
      "Una toma aérea cinematográfica de un carro rojo descapotable.",
      "",
      "https://example.test/a-very-long-reference-url-that-cannot-break-on-spaces?take=1&angle=aerial&and=more",
      "",
      "El mar queda siempre al lado derecho del encuadre.",
    ].join("\n");

    await field.click();
    await field.fill(long);

    const overflow = await field.evaluate((node) => {
      const el = node as HTMLTextAreaElement;
      return {
        horizontal: el.scrollWidth - el.clientWidth,
        vertical: el.scrollHeight - el.clientHeight,
        value: el.value,
      };
    });

    // An unbreakable URL must wrap, not push the box sideways.
    expect(overflow.horizontal, "horizontal overflow").toBeLessThanOrEqual(1);
    // And the text is returned exactly as typed — blank lines included.
    expect(overflow.value).toBe(long);
  });

  test("typing does not alter the submitted value", async ({ page }) => {
    /**
     * The one assertion here that is not about spacing. A presentation change
     * must not touch content, and "fix the padding with a leading space" is a
     * real thing people do.
     */
    const field = await homepagePrompt(page, "Image");
    const typed = "  Atheos padding test\n\n\tindented line  ";
    await field.click();
    await field.fill(typed);
    expect(await field.inputValue()).toBe(typed);
  });
});

test.describe("studio prompt editor", () => {
  test("reserves the writing-assistant lane", async ({ page }) => {
    // `/studio` is authenticated; `(dev)/studio-preview` renders the same
    // production component and is enabled only outside production.
    const response = await page.goto("/studio-preview");
    test.skip(
      !response || response.status() === 404,
      "studio-preview is disabled on this deployment",
    );

    const field = page.locator("textarea[data-studio-prompt]").first();
    await expect(field).toBeVisible();
    await field.click();
    await field.fill("Atheos padding test");

    const box = await measure(field);
    assertMultiline(box, { overlayRight: true });
  });
});

test.describe("single-line fields", () => {
  test("keep text clear of the border and of their icons", async ({ page }) => {
    const response = await page.goto("/design-system");
    test.skip(
      !response || response.status() === 404,
      "design-system is disabled on this deployment",
    );

    const inputs = page.locator("input[data-slot='input']");
    const count = await inputs.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const box = await measure(inputs.nth(i));
      expect(box.paddingLeft, `input ${i} padding-left`).toBeGreaterThanOrEqual(
        SINGLE_LINE.paddingXMin,
      );
      expect(
        box.paddingRight,
        `input ${i} padding-right`,
      ).toBeGreaterThanOrEqual(SINGLE_LINE.paddingXMin);
      expect(box.height, `input ${i} height`).toBeGreaterThanOrEqual(
        SINGLE_LINE.heightMin,
      );
    }
  });
});

test.describe("an overlay cannot cover the text", () => {
  test("a button injected into the corner stays clear of the caret", async ({
    page,
  }) => {
    /**
     * Grammarly cannot be installed in CI, so this simulates what it does:
     * absolutely positions a button in the bottom-right of the field and checks
     * that the text box's own content area does not reach underneath it.
     *
     * The extension is never disabled to make this pass — that would take a
     * tool away from the user to fix our layout.
     */
    const field = await homepagePrompt(page, "Image");
    await field.click();
    await field.fill("A".repeat(400));

    const clear = await field.evaluate((node) => {
      const el = node as HTMLTextAreaElement;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      const badge = document.createElement("div");
      badge.style.cssText =
        "position:absolute;width:28px;height:28px;pointer-events:none";
      badge.style.left = `${rect.right - 36}px`;
      badge.style.top = `${rect.bottom - 36}px`;
      document.body.appendChild(badge);
      const badgeRect = badge.getBoundingClientRect();
      badge.remove();

      // Right edge of the text content area, inside the padding.
      const contentRight = rect.right - parseFloat(cs.paddingRight);
      return { contentRight, badgeLeft: badgeRect.left };
    });

    expect(
      clear.contentRight,
      "text content must end before the overlay begins",
    ).toBeLessThanOrEqual(clear.badgeLeft);
  });
});
