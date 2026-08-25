import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ShotPlanPreview } from "@/features/studio/components/shot-plan";
import { MOTION_1, MOTION_PRO } from "@/services/ai/sequence-models";

const CINEMATIC_ES =
  "video cinematográfico del carro rojo desde el cielo, de todos los ángulos, con audio";

const CONTINUOUS_ES = "un carro rojo en la carretera de la costa, sin cortes";

function renderPanel(
  props: Partial<React.ComponentProps<typeof ShotPlanPreview>> = {},
) {
  const onModeChange = vi.fn();
  render(
    <ShotPlanPreview
      prompt={CINEMATIC_ES}
      durationSeconds={5}
      facts={MOTION_PRO}
      mode="continuous"
      onModeChange={onModeChange}
      {...props}
    />,
  );
  return { onModeChange };
}

/**
 * Find a card by its title rather than its position.
 *
 * There are three strategies now, and positional indexing made the tests
 * silently test the wrong card the moment one was inserted above another.
 */
function card(title: RegExp): HTMLElement {
  const heading = screen.getByText(title);
  const button = heading.closest("button");
  if (!button) throw new Error(`no card for ${title}`);
  return button;
}

describe("choosing what to generate", () => {
  it("shows nothing for an empty prompt", () => {
    const { container } = render(
      <ShotPlanPreview
        prompt="   "
        durationSeconds={5}
        facts={MOTION_PRO}
        mode="continuous"
        onModeChange={() => {}}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("offers both options for a four-angle prompt", () => {
    renderPanel();
    expect(screen.getByText(/describes 4 camera angles/)).toBeTruthy();
    expect(screen.getByText("Continuous single shot")).toBeTruthy();
    expect(screen.getByText(/Advanced chained sequence/)).toBeTruthy();
  });

  it("offers no sequence when the prompt asked for one unbroken take", () => {
    // Nothing to choose between, and a choice offered where none exists is
    // just another way to charge for something nobody wanted.
    renderPanel({ prompt: CONTINUOUS_ES });
    expect(screen.queryByText(/camera angles/)).toBeNull();
    expect(screen.queryByText(/sequence/)).toBeNull();
  });

  it("prices each option separately and visibly", () => {
    /**
     * The number that was missing. The old panel showed one price — the
     * single-shot one — under a four-shot plan, so the sequence looked like it
     * cost 90 credits when it costs eight times that.
     */
    renderPanel();
    expect(screen.getByText("180 credits")).toBeTruthy();
    expect(screen.getByText("720 credits")).toBeTruthy();
  });

  it("selects a mode when its card is clicked", () => {
    const { onModeChange } = renderPanel({ multiShotAvailable: true });
    fireEvent.click(card(/Advanced chained sequence/));
    expect(onModeChange).toHaveBeenCalledWith("multi_shot");
  });

  it("marks the chosen mode as pressed", () => {
    renderPanel({ mode: "multi_shot" });
    expect(card(/Continuous single shot/).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(card(/Advanced chained sequence/).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("offers all three strategies for a multi-angle prompt", () => {
    renderPanel();
    expect(card(/Continuous single shot/)).toBeTruthy();
    expect(card(/Directed camera movement/)).toBeTruthy();
    expect(card(/Advanced chained sequence/)).toBeTruthy();
  });
});

describe("the disclosure before spending", () => {
  it("states calls, seconds generated, final length, resolution, cost and wait", () => {
    renderPanel({ mode: "multi_shot" });

    expect(screen.getAllByText("Provider calls").length).toBeGreaterThan(0);
    // 20 seconds bought to deliver 5 — the fact that makes the price make sense.
    expect(screen.getByText("20s (5 + 5 + 5 + 5)")).toBeTruthy();
    // Both cards deliver 5s — the difference is what it costs to get there.
    expect(screen.getAllByText("5s · 24fps")).toHaveLength(2);
    expect(screen.getByText("$1.08")).toBeTruthy();
    expect(screen.getByText("~47 min")).toBeTruthy();
  });

  it("names the continuity limitations rather than implying there are none", () => {
    renderPanel({ mode: "multi_shot" });
    expect(screen.getByText(/one after another/)).toBeTruthy();
    expect(screen.getByText(/No reference image was supplied/)).toBeTruthy();
  });

  it("drops the reference-image caveat once one is attached", () => {
    renderPanel({ hasReferenceImage: true });
    expect(screen.queryByText(/No reference image was supplied/)).toBeNull();
  });
});

describe("Motion 1 cannot do a sequence and says so", () => {
  it("refuses rather than offering a worse version", () => {
    /**
     * wan-2.2-t2v-fast has no image input of any kind, so four calls return
     * four unrelated cars. Quoting it at any price would be selling something
     * that cannot work.
     */
    renderPanel({ facts: MOTION_1 });
    expect(screen.getByText(/accepts no image input/)).toBeTruthy();
    expect(screen.getByText(/four unrelated clips/)).toBeTruthy();
  });

  it("does not let the blocked option be selected", () => {
    const { onModeChange } = renderPanel({ facts: MOTION_1 });
    const chained = card(/Advanced chained sequence/);
    fireEvent.click(chained);
    expect(onModeChange).not.toHaveBeenCalled();
    expect(chained.hasAttribute("disabled")).toBe(true);
  });

  it("blocks the directed strategy too, for the same model", () => {
    // Motion 1 is a 5-second text-to-video model. It cannot hold four beats in
    // one clip any more than it can carry a scene across four of them.
    renderPanel({ facts: MOTION_1 });
    expect(screen.getByText(/not documented for holding/)).toBeTruthy();
  });

  it("shows no price for something that cannot be made", () => {
    // A price on a blocked option reads as an offer.
    renderPanel({ facts: MOTION_1 });
    expect(screen.queryByText("360 credits")).toBeNull();
  });

  it("still offers the continuous shot, which it can do", () => {
    renderPanel({ facts: MOTION_1 });
    expect(screen.getByText("90 credits")).toBeTruthy();
  });
});

describe("resolution and audio are never overstated", () => {
  it("reports 720p for Motion 1, whatever the Size control says", () => {
    renderPanel({ facts: MOTION_1 });
    expect(screen.getByText("720p")).toBeTruthy();
  });

  it("says upscaled when the export is larger than the render", () => {
    renderPanel({ facts: MOTION_1, requestedResolution: "1080p" });
    expect(screen.getByText("1080p (upscaled from 720p)")).toBeTruthy();
    // The claim that would be false: bare "1080p" on a 720p render.
    expect(screen.queryByText("1080p")).toBeNull();
  });

  it("credits Atheos for the sound, not the model", () => {
    renderPanel();
    expect(
      screen.getAllByText(/Atheos sound mix is not currently available/).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/Audio generated by the video model/)).toBeNull();
  });
});

describe("multi-shot is priced but not yet offered", () => {
  it("shows the full price and says it cannot be run yet", () => {
    /**
     * The orchestrator does not exist: nothing submits four calls, chains their
     * frames, validates continuity and assembles the result. Letting the mode be
     * chosen while that is true would put "Generate 4-shot sequence · 720
     * credits" on a button that submits one call — the same lie pointing the
     * other way.
     */
    renderPanel();
    expect(screen.getByText("720 credits")).toBeTruthy();
    expect(screen.getByText(/Not available yet/)).toBeTruthy();
  });

  it("cannot be selected while it cannot be run", () => {
    const { onModeChange } = renderPanel();
    fireEvent.click(card(/Advanced chained sequence/));
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it("becomes selectable once the orchestrator ships", () => {
    const { onModeChange } = renderPanel({ multiShotAvailable: true });
    fireEvent.click(card(/Advanced chained sequence/));
    expect(onModeChange).toHaveBeenCalledWith("multi_shot");
    expect(screen.queryByText(/Not available yet/)).toBeNull();
  });
});
