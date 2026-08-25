import { expect, test } from "@playwright/test";

/**
 * Studio V2, photographed and inspected.
 *
 * ## Why screenshots are the point here
 *
 * Every other check in this repository asserts behaviour. A layout cannot be
 * asserted that way — "the canvas is the largest area" and "prompt text does
 * not touch its border" are visual properties, and the failure mode of getting
 * them wrong is an interface that works and looks unfinished.
 *
 * So these capture the states a customer moves between and assert the handful
 * of properties that *can* be measured: no horizontal overflow, real padding
 * inside the prompt, truncated history, and no vendor's name anywhere on the
 * page.
 *
 * ## Fixtures, and no credits
 *
 * `/studio-v2-preview` renders from fixed data, so a diff between runs is a
 * change in the interface rather than new work appearing in somebody's
 * history. Nothing here submits, so nothing here can spend.
 */

const PREVIEW = "/studio-v2-preview";
const SHOTS = "test-results/studio-v2";

test.describe("Studio V2 shell", () => {
  test("empty state, desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(PREVIEW);

    await expect(page.getByLabel("Canvas")).toBeVisible();
    await expect(
      page.getByText("Describe what you want to make."),
    ).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/01-empty-1920.png` });
  });

  test("the canvas is the largest region", async ({ page }) => {
    /**
     * The complaint this sprint exists for: four permanent columns left the
     * canvas whatever was spare. Measured rather than eyeballed.
     */
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PREVIEW);

    const canvas = await page.getByLabel("Canvas").boundingBox();
    const nav = await page.getByLabel("Main").boundingBox();

    expect(canvas).not.toBeNull();
    expect(canvas!.width).toBeGreaterThan(900);
    // Navigation is icons, not a column of labels.
    expect(nav!.width).toBeLessThanOrEqual(80);
  });

  test("prompt text never touches its border", async ({ page }) => {
    // The reported defect, asserted as a number.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PREVIEW);

    const padding = await page.getByLabel("Prompt").evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        left: parseFloat(style.paddingLeft),
        right: parseFloat(style.paddingRight),
        top: parseFloat(style.paddingTop),
      };
    });

    expect(padding.left).toBeGreaterThanOrEqual(16);
    expect(padding.right).toBeGreaterThanOrEqual(16);
    expect(padding.top).toBeGreaterThanOrEqual(14);
  });

  test("image, video and audio modes", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PREVIEW);

    await page.getByRole("button", { name: "Image" }).click();
    await page.screenshot({ path: `${SHOTS}/02-image-mode.png` });

    await page.getByRole("button", { name: "Video" }).click();
    // The line the Studio could not show before this sprint.
    await expect(
      page.getByText("Silent output — no native audio"),
    ).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/03-video-mode.png` });

    await page.getByRole("button", { name: "Audio" }).click();
    await page.screenshot({ path: `${SHOTS}/04-audio-mode.png` });
  });

  test("history opens, and long prompts are truncated", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PREVIEW);

    await page.getByRole("button", { name: /Recent/ }).click();

    const entry = page.getByRole("button", { name: /coastal road/i });
    await expect(entry).toBeVisible();

    /**
     * The fixture prompt is ~600 characters. A card that rendered it whole
     * would be taller than the strip; truncation keeps every entry one line.
     */
    const box = await entry.boundingBox();
    expect(box!.height).toBeLessThan(160);

    await page.screenshot({ path: `${SHOTS}/05-history-open.png` });
  });

  test("selecting history opens the inspector", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PREVIEW);

    await page.getByRole("button", { name: /Recent/ }).click();
    await page.getByRole("button", { name: /red dragon/i }).click();

    await expect(page.getByLabel("Generation details")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/06-inspector-open.png` });
  });

  test("the inspector does not permanently hold width", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PREVIEW);

    const closed = await page.getByLabel("Canvas").boundingBox();
    await page.getByRole("button", { name: "Details" }).click();
    const open = await page.getByLabel("Canvas").boundingBox();

    // It takes width only while it is open, and gives it back.
    expect(open!.width).toBeLessThan(closed!.width);

    await page.getByRole("button", { name: "Close details" }).click();
    const reclosed = await page.getByLabel("Canvas").boundingBox();
    expect(reclosed!.width).toBeCloseTo(closed!.width, 0);
  });

  test("the queue is a popover, not a column", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PREVIEW);

    const before = await page.getByLabel("Canvas").boundingBox();
    await page.getByRole("button", { name: "Queue" }).click();

    await expect(page.getByRole("dialog", { name: "Queue" })).toBeVisible();
    const after = await page.getByLabel("Canvas").boundingBox();

    // Opening it costs the canvas nothing.
    expect(after!.width).toBe(before!.width);
    await page.screenshot({ path: `${SHOTS}/07-queue-open.png` });
  });

  test("no vendor is named anywhere on the page", async ({ page }) => {
    /**
     * The whole provider-abstraction sprint, checked where it actually
     * matters: in the rendered document a customer can read and view-source.
     */
    await page.goto(PREVIEW);
    await page.getByRole("button", { name: /Recent/ }).click();

    const content = await page.content();
    expect(content).not.toMatch(
      /replicate|black-forest|bytedance|wan-video|seedance|musicgen|REPLICATE_API_TOKEN/i,
    );
  });
});

test.describe("responsive", () => {
  for (const [name, width, height] of [
    ["1280", 1280, 800],
    ["tablet-1024", 1024, 768],
    ["mobile-390", 390, 844],
  ] as const) {
    test(`no horizontal overflow at ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(PREVIEW);

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );

      // A single pixel of horizontal scroll is a layout bug on a phone.
      expect(overflow).toBeLessThanOrEqual(0);

      await page.screenshot({ path: `${SHOTS}/08-${name}.png` });
    });
  }

  test("the composer stays reachable on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PREVIEW);

    await expect(page.getByLabel("Prompt")).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate" })).toBeVisible();
  });
});

test.describe("keyboard and labels", () => {
  test("every control the keyboard reaches is named", async ({ page }) => {
    await page.goto(PREVIEW);

    const unnamed = await page.evaluate(() => {
      const focusable = [
        // `a[href]`, not `[href]`: the broad selector matches every
        // `<link rel="stylesheet">` in the head, which is not a control
        // and cannot carry a name.
        ...document.querySelectorAll<HTMLElement>("button, a[href], textarea"),
      ];
      return focusable
        .filter((el) => {
          const name =
            el.getAttribute("aria-label") ??
            el.getAttribute("title") ??
            el.textContent?.trim();
          return !name;
        })
        .map((el) => el.tagName)
        .slice(0, 5);
    });

    expect(unnamed).toEqual([]);
  });

  test("focus is visible when tabbing", async ({ page }) => {
    await page.goto(PREVIEW);
    await page.keyboard.press("Tab");

    const visible = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const style = getComputedStyle(el);
      return style.outlineStyle !== "none" || style.boxShadow !== "none";
    });

    expect(visible).toBe(true);
  });
});
