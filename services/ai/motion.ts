/**
 * Camera motion vocabulary.
 *
 * Shared by every video adapter, because these phrases are prompt text and
 * describing the same movement three different ways across three providers
 * would produce three different results for one UI selection.
 *
 * Deliberately plain language. Video models are trained on captions, not on a
 * control API, so "slow push in" outperforms "dolly_in: 0.4" — the phrase is
 * the parameter. An adapter whose vendor *does* expose structured motion is
 * free to map these onto it in its own `buildInput`; that is the adapter's job,
 * not the studio's.
 */
export const CAMERA_MOTIONS = [
  "static camera",
  "slow push in",
  "slow pull back",
  "pan left",
  "pan right",
  "tilt up",
  "tilt down",
  "orbit around the subject",
  "crane up",
  "handheld follow",
  "aerial drone shot",
] as const;

export type CameraMotion = (typeof CAMERA_MOTIONS)[number];
