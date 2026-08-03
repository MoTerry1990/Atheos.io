import type { ModelCapabilities } from "@/services/ai/types";

/**
 * Pricing.
 *
 * Deliberately **not** `server-only`. The composer has to show a cost before
 * the button is pressed, and the server has to charge one — and those two
 * numbers disagreeing is the single most damaging kind of bug in a credits
 * product. So the arithmetic lives here, imported by both, rather than being
 * written twice and drifting.
 *
 * ## Duration is a multiplier, not a tier
 *
 * A model's `creditCost` is the price of one output at its **shortest**
 * declared duration. Ten seconds of video costs roughly twice what five does at
 * every vendor we have looked at, because the cost is compute time, so scaling
 * linearly from the shortest clip is both simple and close to true. Rounded up:
 * we would rather absorb a rounding error than bill one.
 */

export interface PriceableModel {
  creditCost: number;
  capabilities: Pick<ModelCapabilities, "durations">;
}

/** How much longer than the shortest clip this request is. 1 for images. */
export function durationMultiplier(
  durations: readonly number[] | undefined,
  durationSeconds: number | undefined,
): number {
  if (!durations?.length || !durationSeconds) return 1;

  const base = Math.min(...durations);
  if (base <= 0) return 1;

  return Math.max(1, durationSeconds / base);
}

/** Credits a request costs. The one definition, used on both sides. */
export function creditsFor(
  model: PriceableModel,
  outputs: number,
  durationSeconds?: number,
): number {
  const multiplier = durationMultiplier(
    model.capabilities.durations,
    durationSeconds,
  );

  // Upscale and background removal always produce one output regardless of what
  // was asked for, so callers pass the clamped count rather than the requested
  // one — clamping is the caller's job because only it knows the operation.
  return Math.ceil(model.creditCost * Math.max(1, outputs) * multiplier);
}
