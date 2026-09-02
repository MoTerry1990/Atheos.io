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

  test("offers every video model the owner may run", async ({ page }) => {
    await openVideo(page);

    // Five since Cinematic Next joined. Listed rather than counted, so adding
    // a model has to be a deliberate edit here.
    for (const name of [
      "Motion 1",
      "Motion Pro",
      "Cinematic Fast",
      "Cinematic",
      "Cinematic Next",
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

/**
 * The two promises Cinematic Next must not make, photographed.
 *
 * It is the only model that chooses its own clip length and the only one whose
 * audio cannot be turned off, so it is the only one where "10 seconds" and
 * "Silent" would both be lies. These capture the states a customer actually
 * reaches.
 */
test.describe("Cinematic Next", () => {
  const openVideo = async (page: import("@playwright/test").Page) => {
    await page.goto(PREVIEW);
    await page.getByRole("button", { name: "Video" }).click();
  };

  const select = async (page: import("@playwright/test").Page) => {
    await openVideo(page);
    await page.getByRole("radio", { name: /Cinematic Next/ }).click();
  };

  test("says 'Up to 10s' rather than promising a length", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await select(page);

    const card = page.getByRole("radio", { name: /Cinematic Next/ });
    await expect(card).toContainText("Up to 10s");
    await expect(card).toContainText("720p");
    await expect(card).toContainText("Native audio");
    await expect(card).toContainText("630 credits");

    // The composer repeats it in full words.
    await expect(page.getByText("Up to 10 seconds")).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/14-cinematic-next-native.png` });
  });

  test("refuses Silent, blocks Generate and offers both ways out", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await select(page);

    await page.getByRole("radio", { name: /^Silent/ }).click();

    /**
     * Located by id, not by role.
     *
     * `getByRole("alert")` also matches `#__next-route-announcer__`, the empty
     * live region Next renders on every page for route changes. That is
     * framework infrastructure rather than a second competing announcement,
     * and the strict-mode violation it caused was a selector problem here, not
     * a defect in the interface.
     */
    const alert = page.locator("#studio-audio-conflict");
    await expect(alert).toContainText("Not available:");
    await expect(alert).toContainText(
      "This model always creates native audio.",
    );

    // The smaller change first, then the model swap with its price.
    await expect(alert.getByRole("button", { name: "Use Auto" })).toBeVisible();
    await expect(
      alert.getByRole("button", { name: "Use Native audio" }),
    ).toBeVisible();
    await expect(
      alert.getByRole("button", { name: /Switch to Motion 1/ }),
    ).toBeVisible();

    const generate = page.getByRole("button", { name: /Generate/ });
    await expect(generate).toBeDisabled();

    // The reason is attached to the control it blocks, not merely nearby.
    const describedBy = await generate.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toContainText(
      "always creates native audio",
    );

    await page.screenshot({ path: `${SHOTS}/15-silent-conflict.png` });
  });

  test("keeps the customer's choice rather than switching it for them", async ({
    page,
  }) => {
    await select(page);
    const silent = page.getByRole("radio", { name: /^Silent/ });
    await silent.click();

    // Still theirs. The conflict is shown; the selection is not overruled.
    await expect(silent).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#studio-audio-conflict")).toBeVisible();
  });

  test("a model change does not carry an incompatible choice", async ({
    page,
  }) => {
    await select(page);
    await page.getByRole("radio", { name: /^Silent/ }).click();
    await expect(page.locator("#studio-audio-conflict")).toBeVisible();

    // Motion 1 can deliver silence, so the conflict clears on its own.
    await page.getByRole("radio", { name: /Motion 1/ }).click();
    await expect(page.locator("#studio-audio-conflict")).toHaveCount(0);

    // And returning brings it back rather than leaving a stale allowance.
    await page.getByRole("radio", { name: /Cinematic Next/ }).click();
    await expect(page.locator("#studio-audio-conflict")).toBeVisible();
  });

  test("reads correctly on a tablet", async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 1112 });
    await select(page);
    await page.getByRole("radio", { name: /^Silent/ }).click();

    await expect(page.locator("#studio-audio-conflict")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow).toBe(false);

    await page.screenshot({ path: `${SHOTS}/16-tablet-silent.png` });
  });

  test("names no vendor in any of it", async ({ page }) => {
    await select(page);
    await page.getByRole("radio", { name: /^Silent/ }).click();

    const text = (await page.locator("body").innerText()).toLowerCase();
    for (const vendor of ["google", "gemini", "omni", "vertex", "replicate"]) {
      expect(text, vendor).not.toContain(vendor);
    }
  });
});

/**
 * Light and dark, through the application's own persistence.
 *
 * `next-themes` is configured `attribute="class"` with `defaultTheme="dark"`,
 * so the interface opens dark and a *real* preference is stored in
 * `localStorage`. Writing that key is what the Settings control does — this is
 * the same mechanism rather than a class toggled onto `<html>` by hand, which
 * would prove nothing about whether the theme is actually supported.
 */
test.describe("themes", () => {
  test("dark is the default, and light is genuinely selectable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PREVIEW);

    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.screenshot({ path: `${SHOTS}/17-theme-dark.png` });

    await page.evaluate(() => localStorage.setItem("theme", "light"));
    await page.reload();

    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await page.screenshot({ path: `${SHOTS}/18-theme-light.png` });

    /**
     * Measured, not eyeballed.
     *
     * A theme that flips the class and leaves a control unreadable is not a
     * supported theme. This records the computed colours so the report can say
     * which it is rather than guessing from a thumbnail.
     */
    const contrast = await page.evaluate(() => {
      const gen = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Generate",
      );
      const body = getComputedStyle(document.body);
      const g = gen ? getComputedStyle(gen) : null;
      return {
        bodyBg: body.backgroundColor,
        bodyColor: body.color,
        generateBg: g?.backgroundColor ?? null,
        generateColor: g?.color ?? null,
      };
    });

    /**
     * Attached to the run rather than logged.
     *
     * `console.log` is banned by the lint config, and rightly — a stray one in
     * a suite is noise forever. An attachment lands in the HTML report next to
     * the screenshot it describes, which is where somebody comparing them
     * would actually look.
     */
    await test.info().attach("light-theme-colours", {
      body: JSON.stringify(contrast, null, 2),
      contentType: "application/json",
    });

    /**
     * The one thing worth asserting rather than recording: the theme actually
     * repaints. A light theme that leaves the body dark is a class change and
     * nothing else.
     */
    expect(contrast.bodyBg).not.toBe("oklch(0.129 0.005 300)");
    expect(contrast.generateColor).toBeTruthy();
  });
});

/**
 * The home page hero, photographed from the production build.
 *
 * ## Why these are here rather than in a unit test
 *
 * Autoplay policy, `prefers-reduced-motion` and Save-Data are browser
 * behaviours. A unit test can assert that the markup says `muted`; only a
 * browser can show that nothing plays when the visitor asked for stillness.
 */
test.describe("home page hero", () => {
  const SHOTS_HOME = "test-results/homepage";

  /**
   * The hero decides for itself whether to run.
   *
   * `shouldPlayVideo` refuses on reduced motion, Save-Data, a slow connection,
   * a phone, and low-end hardware — and headless Chromium reports low
   * `hardwareConcurrency`, so it legitimately refuses here too. That makes
   * "the Pause button is visible" the wrong assertion: it would fail on
   * correct behaviour.
   *
   * The contract is the pairing. A hero video without controls is the defect;
   * a poster without controls is the designed fallback.
   */
  const heroState = (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const video = document.querySelector("video[autoplay]");
      return {
        hasHeroVideo: Boolean(video),
        muted: video ? (video as HTMLVideoElement).muted : null,
        hasPause: Boolean(
          document.querySelector('[aria-label*="background video"]'),
        ),
        hasAudioButton: Boolean(
          document.querySelector('[aria-label*="Hear audio"]'),
        ),
      };
    });

  test("a running hero always carries its controls", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForTimeout(500);

    const state = await heroState(page);

    if (state.hasHeroVideo) {
      // If it plays, it is muted and it can be stopped and unmuted.
      expect(state.muted, "hero autoplays with sound").toBe(true);
      expect(state.hasPause, "playing hero has no pause control").toBe(true);
      expect(state.hasAudioButton, "playing hero has no audio control").toBe(
        true,
      );
    }

    // The disclosure is not conditional on playback.
    await expect(page.getByText(/AI-generated video/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS_HOME}/01-hero-desktop.png` });
  });

  test("nothing autoplays under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForTimeout(500);

    /**
     * Scoped to `[autoplay]`, not to every `<video>`.
     *
     * The showcase cards render video elements too; they are poster-first and
     * play on click, which is correct and must not fail this. What must never
     * happen is anything starting by itself.
     */
    await expect(page.locator("video[autoplay]")).toHaveCount(0);

    const playing = await page.evaluate(() =>
      Array.from(document.querySelectorAll("video")).some((v) => !v.paused),
    );
    expect(playing, "something is playing under reduced motion").toBe(false);

    await page.screenshot({ path: `${SHOTS_HOME}/03-reduced-motion.png` });
  });

  test("mobile stays on the poster", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForTimeout(500);

    // A full-bleed loop is the least valuable and most expensive thing on a
    // metered radio, so the hero never creates one below 768px.
    await expect(page.locator("video[autoplay]")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS_HOME}/04-hero-mobile.png` });
  });

  test("the withdrawn media is nowhere on the page", async ({ page }) => {
    await page.goto("/");
    const html = await page.content();

    for (const gone of [
      "made-video-5",
      "made-video-6",
      "template-1",
      "template-2",
      "feature-craft",
      "gallery-1",
    ]) {
      expect(html, gone).not.toContain(gone);
    }
  });

  test("the 44 MB master is never referenced, and no vendor is named", async ({
    page,
  }) => {
    await page.goto("/");
    const html = await page.content();

    expect(html).not.toContain("media-source");
    expect(html).not.toContain("master.mp4");
    for (const vendor of ["FLUX", "replicate", "veo", "gemini", "bytedance"]) {
      expect(html.toLowerCase(), vendor).not.toContain(vendor.toLowerCase());
    }
  });

  test("secondary videos do not autoplay", async ({ page }) => {
    await page.goto("/");

    const autoplaying = await page.evaluate(() =>
      Array.from(document.querySelectorAll("video"))
        .filter((v) => v.autoplay)
        .map((v) => v.currentSrc || "hero"),
    );

    // Only the hero, and only when it is eligible at all.
    expect(autoplaying.length).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: `${SHOTS_HOME}/05-showcase.png`,
      fullPage: true,
    });
  });

  test("content details explains the derivative without overclaiming", async ({
    page,
  }) => {
    await page.goto("/content-details");

    await expect(page.getByText(/AI-generated/).first()).toBeVisible();
    await expect(
      page.getByText(/cannot be verified with a content-credentials checker/),
    ).toBeVisible();
    await page.screenshot({ path: `${SHOTS_HOME}/06-content-details.png` });
  });
});
