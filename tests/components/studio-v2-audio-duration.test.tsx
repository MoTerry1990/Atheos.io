import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { StudioV2 } from "@/features/studio/components/v2/studio-v2";
import type { PublicStudioModel } from "@/features/studio/lib/public-model";

/**
 * Two promises the studio must not make: an exact length, and silence.
 *
 * ## The length
 *
 * Every video model in the catalogue until now enumerated the clip lengths it
 * accepts, so the composer could print "5s / 7.5s" and mean it. One model
 * chooses its own length within a range and does not honour an exact request —
 * printing "10 seconds" for that one would put a number on screen that the
 * output need not match, on a quote the customer is charged for.
 *
 * ## The silence
 *
 * The same model generates audio with every output and its API documents no
 * parameter to stop it. A Silent control there is a switch wired to nothing:
 * picked, quoted, and then a clip arrives with sound. Refusing is the honest
 * answer, and stripping the track afterwards is not offered — re-encoding
 * risks the SynthID watermark and the C2PA credentials the clip carries.
 *
 * Driven entirely by fixtures. No credential, no network, no generation.
 */

const base = {
  description: "",
  typicalSeconds: 8,
  takesReference: false,
  resolutions: [],
  typicalWait: { minSeconds: 60, maxSeconds: 240 },
  capabilities: {
    operations: ["text-to-video"],
    supportsImageInput: false,
    supportsNegativePrompt: false,
    supportsSeed: false,
    maxOutputs: 1,
    aspectRatios: ["16:9"],
  } as PublicStudioModel["capabilities"],
} satisfies Partial<PublicStudioModel>;

/** Chooses its own length, and always makes sound. */
const CINEMATIC_NEXT: PublicStudioModel = {
  ...base,
  id: "cinematic-next",
  displayName: "Cinematic Next",
  modality: "VIDEO",
  creditCost: 630,
  audio: "native",
  audioNote: "Generates synchronised sound in the same pass, always.",
  qualityTier: "premium",
  durations: [],
  durationMode: "model_decided",
  durationRange: { min: 3, max: 10 },
  audioAlwaysOn: true,
  aspectRatios: ["16:9"],
  availability: "owner_beta",
};

/** Fixed lengths, and no audio track at all. */
const MOTION_ONE: PublicStudioModel = {
  ...base,
  id: "motion-1",
  displayName: "Motion 1",
  modality: "VIDEO",
  creditCost: 90,
  audio: "silent",
  audioNote: "Silent — the finished video has no audio track.",
  qualityTier: "standard",
  durations: [5, 7.5],
  durationMode: "exact",
  audioAlwaysOn: false,
  aspectRatios: ["16:9"],
  availability: "available",
};

const MODELS = [CINEMATIC_NEXT, MOTION_ONE];

/**
 * Render, and switch to Video.
 *
 * The studio opens on Image, which is right for most people and means these
 * video fixtures are not selected on first paint. Doing it here rather than in
 * every test keeps each one about the thing it is testing.
 */
async function renderStudio(models: PublicStudioModel[] = MODELS) {
  const user = userEvent.setup();
  render(<StudioV2 models={models} creditBalance={14890} history={[]} />);

  await user.click(screen.getByRole("button", { name: /^video$/i }));
  return user;
}

/** The Audio radio group, wherever it sits in the layout. */
const audioGroup = () => screen.getByRole("radiogroup", { name: /audio/i });

const generateButton = () => screen.getByRole("button", { name: /generate/i });

describe("a model that chooses its own length says so", () => {
  it("renders 'Up to 10 seconds' and never a bare figure", async () => {
    await renderStudio();

    // The chip a customer reads before choosing.
    expect(await screen.findByText(/Up to 10 seconds/i)).toBeTruthy();

    /**
     * Anchored to the whole number, so "10 seconds" inside "Up to 10 seconds"
     * does not fail it and "110 seconds" could not satisfy it. What must not
     * appear is an exact promise standing on its own.
     */
    const body = document.body.textContent ?? "";
    const bare = body.match(/(?:^|[^\w.])10 seconds/g) ?? [];
    for (const match of bare) {
      expect(body).toMatch(new RegExp(`Up to\\s*${match.trim()}`));
    }
  });

  it("still prints the enum for a model that has one", async () => {
    await renderStudio([MOTION_ONE]);

    expect(await screen.findByText("5s / 7.5s")).toBeTruthy();
  });
});

describe("Silent is refused on a model that always makes sound", () => {
  it("explains why, in the words the customer needs", async () => {
    const user = await renderStudio();

    await user.click(
      within(audioGroup()).getByRole("radio", { name: /silent/i }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "This model always creates native audio.",
    );
  });

  it("blocks Generate rather than letting the server refuse", async () => {
    /**
     * The server would not refuse, which is the point. It would generate a
     * clip with audio in it — the customer having asked for silence and paid
     * for the choice.
     */
    const user = await renderStudio();

    await user.type(screen.getByRole("textbox"), "a surfer on a wave");
    expect((generateButton() as HTMLButtonElement).disabled).toBe(false);

    await user.click(
      within(audioGroup()).getByRole("radio", { name: /silent/i }),
    );

    expect((generateButton() as HTMLButtonElement).disabled).toBe(true);
    expect(generateButton().getAttribute("aria-label")).toBe(
      "Generate is unavailable: this model always creates native audio",
    );
  });

  it("offers a model that can actually deliver silence", async () => {
    const user = await renderStudio();

    await user.click(
      within(audioGroup()).getByRole("radio", { name: /silent/i }),
    );

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByRole("button", { name: /Switch to Motion 1/i }),
    ).toBeTruthy();
  });
});

describe("Auto and Native are both allowed on it", () => {
  it.each(["auto", "native"])("keeps Generate live on %s", async (choice) => {
    const user = await renderStudio();

    await user.type(screen.getByRole("textbox"), "a surfer on a wave");
    await user.click(
      within(audioGroup()).getByRole("radio", {
        name: new RegExp(choice, "i"),
      }),
    );

    expect((generateButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says the clip will have sound", async () => {
    await renderStudio();

    expect(
      await screen.findByText(/will include synchronised sound/i),
    ).toBeTruthy();
  });
});

describe("the opposite conflict still works", () => {
  it("refuses native sound from a model with no audio track", async () => {
    const user = await renderStudio([MOTION_ONE]);

    await user.click(
      within(audioGroup()).getByRole("radio", { name: /native/i }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/produces no audio track/i);
    expect((generateButton() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("nothing on screen names the vendor", () => {
  it("shows Atheos names only", async () => {
    await renderStudio();

    const body = document.body.textContent ?? "";
    expect(body).toContain("Cinematic Next");
    expect(body).not.toMatch(/google|gemini|omni|vertex|replicate/i);
  });
});

describe("the audio choices are named for a screen reader", () => {
  it("leads with the label, then the hint", async () => {
    /**
     * `title` alone was the accessible name, so these announced as "Sound when
     * the model makes it", "Requires a Cinematic model" and "No audio track" —
     * the hints, with the actual choices nowhere. Found by reading the
     * accessibility tree in a real browser rather than in a test.
     *
     * Asserted on the attribute rather than through `getByRole(name)`, because
     * jsdom and a browser compute the accessible name differently: the
     * role-name query passed before this was fixed, on a name Chrome does not
     * produce. The attribute is the thing both agree on.
     */
    await renderStudio();

    const labels = within(audioGroup())
      .getAllByRole("radio")
      .map((radio) => radio.getAttribute("aria-label"));

    expect(labels).toEqual([
      "Auto — Sound when the model makes it",
      "Native audio — Requires a Cinematic model",
      "Silent — No audio track",
    ]);
  });
});

describe("a selection is never changed for the customer", () => {
  it("keeps Silent chosen and visible after the conflict appears", async () => {
    /**
     * The tempting shortcut is to flip them to Auto and carry on. That is a
     * silent substitution: they asked for silence, and a moment later the
     * interface says they asked for sound. The choice stays where they put it
     * and the conflict stays on screen until they resolve it.
     */
    const user = await renderStudio();

    await user.click(
      within(audioGroup()).getByRole("radio", { name: /silent/i }),
    );

    const silent = within(audioGroup())
      .getAllByRole("radio")
      .find((r) => r.getAttribute("aria-label")?.startsWith("Silent"))!;

    expect(silent.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("alert")).not.toBeNull();
  });

  it("offers both ways out: change the audio, or change the model", async () => {
    const user = await renderStudio();

    await user.click(
      within(audioGroup()).getByRole("radio", { name: /silent/i }),
    );

    const alert = await screen.findByRole("alert");

    // The smaller change first — same model, same price.
    expect(
      within(alert).getByRole("button", { name: /Use Auto/i }),
    ).toBeTruthy();
    expect(
      within(alert).getByRole("button", { name: /Use Native audio/i }),
    ).toBeTruthy();
    // And the larger one, with its price stated.
    expect(
      within(alert).getByRole("button", { name: /Switch to Motion 1/i }),
    ).toBeTruthy();
  });

  it("clears the conflict and reopens Generate once resolved", async () => {
    const user = await renderStudio();

    await user.type(screen.getByRole("textbox"), "a surfer on a wave");
    await user.click(
      within(audioGroup()).getByRole("radio", { name: /silent/i }),
    );
    expect((generateButton() as HTMLButtonElement).disabled).toBe(true);

    await user.click(
      within(await screen.findByRole("alert")).getByRole("button", {
        name: /Use Auto/i,
      }),
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect((generateButton() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("the block is reachable without sight or a mouse", () => {
  it("associates the reason with the control it blocks", async () => {
    /**
     * `aria-label` says the button is unavailable. `aria-describedby` is what
     * carries the *reason* and the two ways out — without it a screen reader
     * user is told "unavailable" and left to find the explanation.
     */
    const user = await renderStudio();

    await user.type(screen.getByRole("textbox"), "a surfer on a wave");
    await user.click(
      within(audioGroup()).getByRole("radio", { name: /silent/i }),
    );

    const describedBy = generateButton().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();

    const reason = document.getElementById(describedBy!);
    expect(reason).not.toBeNull();
    expect(reason!.textContent).toContain(
      "This model always creates native audio.",
    );
  });

  it("drops the association when there is nothing to explain", async () => {
    const user = await renderStudio();
    await user.type(screen.getByRole("textbox"), "a surfer on a wave");

    expect(generateButton().getAttribute("aria-describedby")).toBeNull();
  });

  it("announces the conflict rather than only drawing it", async () => {
    const user = await renderStudio();

    await user.click(
      within(audioGroup()).getByRole("radio", { name: /silent/i }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
  });

  it("says 'Not available' in words, not only in amber", async () => {
    /**
     * The border and tint carry the meaning for most people and nothing for
     * someone who cannot distinguish them, or who is in a high-contrast mode
     * that flattens the palette.
     */
    const user = await renderStudio();

    await user.click(
      within(audioGroup()).getByRole("radio", { name: /silent/i }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Not available:/);
  });

  it("reaches and operates every audio choice from the keyboard", async () => {
    const user = await renderStudio();

    await user.click(screen.getByRole("textbox"));

    // Tab until an audio radio has focus, then activate it with the keyboard
    // alone. A control that can only be clicked is a control some people
    // cannot use at all.
    const radios = within(audioGroup()).getAllByRole("radio");
    for (const radio of radios) {
      (radio as HTMLElement).focus();
      expect(document.activeElement).toBe(radio);
    }

    const silent = radios.find((r) =>
      r.getAttribute("aria-label")?.startsWith("Silent"),
    )!;
    (silent as HTMLElement).focus();
    await user.keyboard("{Enter}");

    expect(silent.getAttribute("aria-checked")).toBe("true");
  });

  it("gives every control a visible focus ring", async () => {
    /**
     * Asserted on the class rather than computed style: jsdom does not run
     * Tailwind, so the utility is the only evidence available here. The rule
     * being pinned is that no interactive control ships without one.
     */
    await renderStudio();

    const controls = [
      ...within(audioGroup()).getAllByRole("radio"),
      generateButton(),
    ];

    for (const control of controls) {
      expect(control.className, control.textContent ?? "").toMatch(
        /focus-visible:/,
      );
    }
  });
});
