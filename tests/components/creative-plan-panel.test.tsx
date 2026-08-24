import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CreativePlanPanel } from "@/features/studio/components/creative-plan-panel";
import type { CreativePlanResponse } from "@/features/studio/lib/creative-plan";
import { planFromPrompt } from "@/services/ai/intent-planner";

/**
 * The panel that stands between a prompt and a provider.
 *
 * The behaviour under test is not the layout — it is that Generate cannot be
 * pressed while anything is unresolved, and that an assumption is visibly an
 * assumption. Both were absent from the composer that showed a four-shot plan
 * and submitted a single-take prompt.
 *
 * The brief comes from the real planner rather than a hand-written literal. A
 * literal would let the panel and the planner drift apart and still pass — and
 * drift between what is displayed and what is real is the entire defect class
 * this panel exists to close.
 */

function plan(
  overrides: Partial<CreativePlanResponse> = {},
): CreativePlanResponse {
  const brief = planFromPrompt({
    prompt: "a 10 second commercial of this red car by the ocean",
    referenceImageCount: 1,
  });

  return {
    brief: {
      ...brief,
      // Pinned so the assertions below describe a fixed mix of origins rather
      // than whatever the planner currently infers.
      resolution: { value: "720p", from: "confirmed" },
      shotCount: {
        value: 4,
        from: "inferred",
        because: "commercials are usually edited",
      },
      audioStrategy: { value: "NATIVE", from: "confirmed" },
    },
    assumptions: [
      {
        field: "shotCount",
        value: 4,
        because: "commercials are usually edited",
      },
    ],
    clarifications: [],
    conflicts: [],
    // What the user is accepting by going ahead. Distinct from an alternative's
    // caveat, which is what they would be accepting if they switched.
    caveats: ["Cinematic Long has not been observed producing hard cuts"],
    alternatives: [
      {
        modelId: "replicate/seedance-2.5",
        label: "Cinematic Long",
        compatibility: "partial",
        conflicts: [],
        caveats: ["has not been observed producing hard cuts"],
        credits: 1387,
        estimatedSeconds: 200,
        maxDurationSeconds: 15,
        maxResolution: "720p",
      },
      {
        modelId: "replicate/veo-3.1",
        label: "Cinematic",
        compatibility: "compatible",
        conflicts: [],
        caveats: ["8 seconds maximum, so the plan is trimmed"],
        credits: 960,
        estimatedSeconds: 180,
        maxDurationSeconds: 8,
        maxResolution: "1080p",
      },
    ],
    recommendedModelId: "replicate/seedance-2.5",
    blockingRequirements: [],
    quote: { credits: 1387, estimatedSeconds: 200 },
    finalPromptPreview: {
      modelId: "replicate/seedance-2.5",
      compilerVersion: 1,
      prompt: "An edited sequence of 4 separate shots\n\nSHOT 1 — 0.0–2.5s\n…",
      negativePrompt: "",
      omitted: ["1080p — Cinematic Long renders 720p only"],
    },
    confirmationRequired: true,
    planToken: "token.signature",
    expiresAtMs: 1_700_000_900_000,
    ttlSeconds: 900,
    ...overrides,
  };
}

function renderPanel(overrides: Partial<CreativePlanResponse> = {}) {
  const handlers = {
    onAnswer: vi.fn(),
    onConfirm: vi.fn(),
    onChooseModel: vi.fn(),
    onCancel: vi.fn(),
  };
  render(<CreativePlanPanel plan={plan(overrides)} {...handlers} />);
  return handlers;
}

describe("provenance is visible", () => {
  it("marks what the user asked for and what Atheos assumed", () => {
    renderPanel();
    // "10 seconds" was in the prompt.
    expect(screen.getAllByText("Requested").length).toBeGreaterThan(0);
    // Four shots was not — and must not read as though it were.
    expect(screen.getAllByText("Inferred").length).toBeGreaterThan(0);
  });

  it("shows the reason for an assumption, not just the value", () => {
    // An assumption nobody can see is an assumption nobody can correct.
    renderPanel();
    expect(screen.getByText(/commercials are usually edited/)).toBeTruthy();
  });
});

describe("Generate is gated, not merely warned", () => {
  it("enables confirm when the server issued a token", () => {
    renderPanel();
    const button = screen.getByRole("button", { name: /Confirm and create/ });
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("disables confirm while a capability conflict stands", () => {
    /**
     * The exact failure this replaces: a warning beside a working button, which
     * sent a four-shot request to a single-take model.
     */
    renderPanel({
      conflicts: [
        "Motion 1 renders at most 7.5 seconds; you asked for 10",
        "Motion 1 produces no audio",
      ],
      planToken: null,
      quote: null,
    });
    const button = screen.getByRole("button", { name: /Confirm and create/ });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(
      /cannot create this plan/,
    );
    expect(screen.getByText(/at most 7.5 seconds/)).toBeTruthy();
    expect(screen.getByText(/produces no audio/)).toBeTruthy();
  });

  it("disables confirm while questions are outstanding", () => {
    renderPanel({
      clarifications: [
        {
          field: "shotCount",
          question: "How should the camera sequence work?",
          options: [
            { label: "Four edited shots", value: 4, recommended: true },
            { label: "One continuous shot", value: 1 },
          ],
        },
      ],
      planToken: null,
    });
    expect(
      screen
        .getByRole("button", { name: /Confirm and create/ })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("disables confirm when the server withheld the token", () => {
    // The client does not decide readiness; the absent token does.
    renderPanel({ planToken: null });
    expect(
      screen
        .getByRole("button", { name: /Confirm and create/ })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});

describe("questions", () => {
  it("asks at most three and marks a recommendation", () => {
    const handlers = renderPanel({
      clarifications: [
        {
          field: "shotCount",
          question: "How should the camera sequence work?",
          options: [
            { label: "Four edited shots", value: 4, recommended: true },
            { label: "One continuous shot", value: 1 },
          ],
        },
      ],
      planToken: null,
    });
    expect(
      screen.getByText("How should the camera sequence work?"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Four edited shots/ }));
    expect(handlers.onAnswer).toHaveBeenCalledWith("shotCount", 4);
  });
});

describe("the final prompt is the server's", () => {
  it("shows the compiler and version that produced it", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Show final prompt/ }));
    expect(screen.getByText(/compiler v1/)).toBeTruthy();
    expect(screen.getByText(/This is what the provider receives/)).toBeTruthy();
    expect(screen.getByText(/SHOT 1/)).toBeTruthy();
  });

  it("names what the compiler dropped", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Show final prompt/ }));
    expect(screen.getByText(/Dropped: 1080p/)).toBeTruthy();
  });

  it("is hidden until asked for", () => {
    renderPanel();
    expect(screen.queryByText(/SHOT 1/)).toBeNull();
  });
});

describe("alternatives carry their real price and compromise", () => {
  it("prices each one from the server, not from a client estimate", () => {
    renderPanel();
    const cheaper = screen.getByRole("button", { name: /8 seconds maximum/ });
    expect(cheaper.textContent).toMatch(/960 credits/);
    // Each row prices itself. A single quote for "video" would be the old lie.
    expect(cheaper.textContent).not.toMatch(/1,387/);
  });

  it("switches model on click", () => {
    const handlers = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Cinematic Long/ }));
    expect(handlers.onChooseModel).toHaveBeenCalledWith(
      "replicate/seedance-2.5",
    );
  });

  it("states the compromise of the model already chosen", () => {
    /**
     * An alternative's caveat is what you would be accepting if you switched.
     * What you are accepting *now* is a top-level caveat — it has to be
     * readable without opening anything, because the panel is the last screen
     * before money moves.
     */
    renderPanel();
    expect(
      screen.getByText(
        /Cinematic Long has not been observed producing hard cuts/,
      ),
    ).toBeTruthy();
  });

  it("offers no price when nothing can make the plan", () => {
    renderPanel({
      conflicts: ["Motion 1 produces no audio"],
      quote: null,
      planToken: null,
    });
    expect(
      screen.getByText(/No price until a model can make this/),
    ).toBeTruthy();
  });
});
