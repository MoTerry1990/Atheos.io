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

test.describe("the video model selector", () => {
  /**
   * The defect this sprint exists for.
   *
   * The owner's catalogue genuinely contained Motion Pro and both Cinematic
   * tiers, and the Studio showed none of them — it pinned `available[0]` and
   * offered no way to change it. It read as a missing catalogue and was a
   * missing control, which is why these assert the *cards*, not the response.
   */
  const openVideo = async (page: import("@playwright/test").Page) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PREVIEW);
    await page.getByRole("button", { name: "Video" }).click();
  };

  test("offers all four video models", async ({ page }) => {
    await openVideo(page);

    for (const name of [
      "Motion 1",
      "Motion Pro",
      "Cinematic Fast",
      "Cinematic",
    ]) {
      await expect(
        page.getByRole("radio", { name: new RegExp(name) }).first(),
      ).toBeVisible();
    }

    await page.screenshot({ path: `${SHOTS}/09-model-selector.png` });
  });

  test("states silence or sound on every card", async ({ page }) => {
    // The honesty requirement, read off the rendered cards.
    await openVideo(page);
    const group = page.getByRole("radiogroup", { name: "Model" });

    await expect(group.getByText("Silent").first()).toBeVisible();
    await expect(group.getByText("Native audio").first()).toBeVisible();
  });

  test("selecting Motion Pro actually selects it", async ({ page }) => {
    await openVideo(page);

    const card = page.getByRole("radio", { name: /Motion Pro/ });
    await card.click();

    await expect(card).toHaveAttribute("aria-checked", "true");
    // And the audio line follows the selection rather than the first model.
    await expect(page.getByText(/This clip will be silent/)).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/10-motion-pro-selected.png` });
  });

  test("Cinematic Fast reports synchronised sound", async ({ page }) => {
    await openVideo(page);
    await page.getByRole("radio", { name: /Cinematic Fast/ }).click();

    await expect(
      page.getByText(/will include synchronised sound/),
    ).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/11-cinematic-fast-audio.png` });
  });

  test("owner-evaluation models are badged", async ({ page }) => {
    await openVideo(page);
    await expect(page.getByText("Owner evaluation").first()).toBeVisible();
  });

  test("native audio on a Motion model is a conflict, not a warning", async ({
    page,
  }) => {
    /**
     * Submitting anyway would deliver the opposite of what was asked for, so
     * the interface offers the switch rather than letting it through.
     */
    await openVideo(page);
    await page.getByRole("radio", { name: /Motion Pro/ }).click();
    await page
      .getByRole("radiogroup", { name: "Audio" })
      .getByRole("radio", { name: "Native audio" })
      .click();

    /**
     * Scoped to the composer. Next.js mounts its own `role="alert"` route
     * announcer on every page, so an unscoped query matches two elements and
     * fails on strict mode rather than on the thing under test.
     */
    const alert = page.getByLabel("Composer").getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("produces no audio track");
    await expect(
      alert.getByRole("button", { name: /Switch to Cinematic Fast/ }),
    ).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/12-audio-conflict.png` });
  });

  test("the switch names its price before it is taken", async ({ page }) => {
    // Never silently increase the customer's cost.
    await openVideo(page);
    await page.getByRole("radio", { name: /Motion Pro/ }).click();
    await page
      .getByRole("radiogroup", { name: "Audio" })
      .getByRole("radio", { name: "Native audio" })
      .click();

    await expect(
      page.getByRole("button", {
        name: /Switch to Cinematic Fast · \d+ credits/,
      }),
    ).toBeVisible();
  });

  test("taking the switch resolves the conflict", async ({ page }) => {
    await openVideo(page);
    await page.getByRole("radio", { name: /Motion Pro/ }).click();
    await page
      .getByRole("radiogroup", { name: "Audio" })
      .getByRole("radio", { name: "Native audio" })
      .click();
    await page
      .getByRole("button", { name: /Switch to Cinematic Fast/ })
      .click();

    await expect(page.getByLabel("Composer").getByRole("alert")).toHaveCount(0);
    await expect(
      page.getByText(/will include synchronised sound/),
    ).toBeVisible();
  });

  test("no vendor is named in the selector", async ({ page }) => {
    await openVideo(page);
    const content = await page.content();

    expect(content).not.toMatch(
      /replicate|google\/veo|bytedance|seedance|wan-video|musicgen/i,
    );
  });

  test("the selector is usable on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PREVIEW);
    await page.getByRole("button", { name: "Video" }).click();

    await expect(
      page.getByRole("radio", { name: /Cinematic Fast/ }),
    ).toBeVisible();

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.screenshot({ path: `${SHOTS}/13-mobile-selector.png` });
  });
});
