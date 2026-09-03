import "server-only";

/**
 * The canonical video format registry.
 *
 * ## Why the server owns this
 *
 * A format is not a display preference. It selects a provider parameter, it
 * changes which models can serve the request at all, it can change the price,
 * and it is the thing the delivered pixels are checked against. A client that
 * could name its own format could name one no model supports, or name a cheap
 * one and receive an expensive one.
 *
 * So the six ids below are the only formats that exist, they are resolved
 * here, and the resolved value travels through the quote, the signed token,
 * the reservation fingerprint and the generation record. `features/studio`
 * receives labels and shapes; it never invents one.
 *
 * ## Aspect ratio and resolution are different things
 *
 * They are stored as separate typed properties on purpose. A ratio is a shape
 * — two integers, exact, used to validate delivered pixels. A resolution is a
 * pixel count the model may or may not offer at that shape. Collapsing them is
 * how "9:16" ends up meaning 720x1280 to one part of the system and 1080x1920
 * to another, and how a 4:5 request gets served a 9:16 file that nobody
 * checked.
 *
 * ## What "exact" means here
 *
 * `ratio` is reduced integers, so 16:9 is `{ w: 16, h: 9 }` and every listed
 * output divides to exactly that. The one nominal case is `cinematic-wide`:
 * the industry calls 2560x1080 "21:9" and it is really 64:27 (2.370, not
 * 2.333). Rather than publish a ratio the pixels do not satisfy, the registry
 * carries the true reduced ratio and `nominalLabel` carries the name people
 * expect to see. A validator comparing delivered pixels against `ratio` is
 * then comparing like with like.
 */

/** The only formats that exist. Anything else is a forged request. */
export const VIDEO_FORMAT_IDS = [
  "social-vertical",
  "portrait-feed",
  "square",
  "landscape",
  "classic",
  "cinematic-wide",
] as const;

export type VideoFormatId = (typeof VIDEO_FORMAT_IDS)[number];

/** A shape, as reduced integers. Never a float, never a string to parse. */
export interface AspectRatio {
  w: number;
  h: number;
}

/** A pixel count. Always paired with the ratio it satisfies. */
export interface Resolution {
  width: number;
  height: number;
}

export interface VideoFormat {
  id: VideoFormatId;
  /** Shown in the picker. */
  label: string;
  ratio: AspectRatio;
  /**
   * What the ratio is conventionally called, when that differs from the true
   * reduced ratio. Display only — never used for validation.
   */
  nominalLabel?: string;
  /** Plain-language guidance, not a list of logos. */
  bestFor: string;
  /**
   * Preferred outputs, best first. Every entry divides to `ratio` exactly;
   * `formatIntegrity` in the test suite asserts it rather than trusting it.
   */
  outputs: readonly Resolution[];
}

export const VIDEO_FORMATS: Readonly<Record<VideoFormatId, VideoFormat>> = {
  "social-vertical": {
    id: "social-vertical",
    label: "Social Vertical",
    ratio: { w: 9, h: 16 },
    bestFor: "TikTok, Reels and Shorts",
    outputs: [
      { width: 1080, height: 1920 },
      { width: 720, height: 1280 },
    ],
  },
  "portrait-feed": {
    id: "portrait-feed",
    label: "Portrait Feed",
    ratio: { w: 4, h: 5 },
    bestFor: "Instagram and Facebook feeds",
    outputs: [{ width: 1080, height: 1350 }],
  },
  square: {
    id: "square",
    label: "Square",
    ratio: { w: 1, h: 1 },
    bestFor: "Social feeds",
    outputs: [{ width: 1080, height: 1080 }],
  },
  landscape: {
    id: "landscape",
    label: "Regular Landscape",
    ratio: { w: 16, h: 9 },
    bestFor: "YouTube, websites and presentations",
    outputs: [
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
    ],
  },
  classic: {
    id: "classic",
    label: "Classic",
    ratio: { w: 4, h: 3 },
    bestFor: "Traditional video and presentations",
    outputs: [
      { width: 1440, height: 1080 },
      { width: 1024, height: 768 },
    ],
  },
  "cinematic-wide": {
    id: "cinematic-wide",
    label: "Cinematic Wide",
    /**
     * 64:27, which is what 2560x1080 actually is. See the note above: calling
     * it 21:9 and then validating delivered pixels against 21:9 would fail
     * every correct delivery.
     */
    ratio: { w: 64, h: 27 },
    nominalLabel: "21:9",
    bestFor: "Trailers, advertisements and cinematic scenes",
    outputs: [{ width: 2560, height: 1080 }],
  },
};

/** Ordered for the picker: the two truthful native paths first. */
export const VIDEO_FORMAT_ORDER: readonly VideoFormatId[] = [
  "social-vertical",
  "landscape",
  "portrait-feed",
  "square",
  "classic",
  "cinematic-wide",
];

/** Narrow an untrusted string. The only way a request names a format. */
export function isVideoFormatId(value: unknown): value is VideoFormatId {
  return (
    typeof value === "string" &&
    (VIDEO_FORMAT_IDS as readonly string[]).includes(value)
  );
}

/**
 * Resolve a format, refusing anything not in the registry.
 *
 * Returns `null` rather than throwing so callers decide how to fail; the quote
 * path fails closed, and the studio path disables the option.
 */
export function videoFormat(id: unknown): VideoFormat | null {
  return isVideoFormatId(id) ? VIDEO_FORMATS[id] : null;
}

/** The ratio as a provider-facing string, e.g. `"9:16"`. */
export function ratioString(ratio: AspectRatio): string {
  return `${ratio.w}:${ratio.h}`;
}

/** Exact shape comparison, done in integers so nothing rounds. */
export function matchesRatio(
  size: { width: number; height: number },
  ratio: AspectRatio,
): boolean {
  return size.width * ratio.h === size.height * ratio.w;
}

/**
 * Whether delivered pixels satisfy a format.
 *
 * Deliberately exact. A "close enough" tolerance is how a stretched or
 * letterboxed file passes validation — the two failure modes the output
 * contract exists to prevent.
 */
export function deliveredMatchesFormat(
  size: { width: number; height: number },
  format: VideoFormat,
): boolean {
  return matchesRatio(size, format.ratio);
}
