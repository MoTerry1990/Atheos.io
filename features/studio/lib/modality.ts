import type { Modality } from "@/features/studio/components/modality-rail";

/**
 * Which model a modality switch should land on.
 *
 * ## Why this is a function and not three lines in the workspace
 *
 * The modality rail spent several sprints as `useState<Modality>("image")` —
 * local state wired to the rail's highlight and to nothing else. Clicking Image
 * while a video model was selected moved the selection pill and left the
 * composer on Motion 1: same model, same "TEXT TO VIDEO" heading, same
 * 90-credit estimate. The workspace's most prominent control did nothing, and
 * the only way to actually change modality was to know that the model dropdown
 * above the prompt also changed it.
 *
 * It could go inert again in exactly the same silent way, because nothing about
 * a decorative control fails a build. Pulling the decision out into a pure
 * function is what makes it testable at all.
 */

/** The catalogue speaks Prisma's enum; the rail speaks lowercase. */
export function modalityOf(model: { modality: string }): Modality {
  switch (model.modality) {
    case "VIDEO":
      return "video";
    case "AUDIO":
      return "audio";
    default:
      // An unrecognised modality should leave the studio usable rather than
      // blank, so it falls back rather than throwing.
      return "image";
  }
}

/**
 * Pick the model to select when the user asks for `next`.
 *
 * Returns `null` when the catalogue has nothing of that kind — the caller must
 * say so rather than doing nothing, which is the same failure in miniature.
 */
export function chooseModelForModality<
  T extends { id: string; modality: string },
>(input: {
  models: readonly T[];
  next: Modality;
  /**
   * The last model used in each modality.
   *
   * Switching to Video and back to Image should return the image model the user
   * was working with, not whichever one happens to be first in the catalogue.
   */
  remembered?: Partial<Record<Modality, string>>;
}): string | null {
  const remembered = input.remembered?.[input.next];

  /**
   * The remembered model has to still exist *and* still be of the right kind.
   *
   * Existence alone is not enough: a stale entry pointing at an image model
   * would satisfy it and put the composer in image mode while the rail says
   * video — the same disagreement this function was written to end.
   */
  if (
    remembered &&
    input.models.some(
      (model) => model.id === remembered && modalityOf(model) === input.next,
    )
  ) {
    return remembered;
  }

  return (
    input.models.find((model) => modalityOf(model) === input.next)?.id ?? null
  );
}
