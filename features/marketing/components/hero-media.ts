/**
 * Hero media filenames and the rules that decide whether the video runs.
 *
 * ## Why the filenames live in a constant
 *
 * They are content-hashed, so they change whenever the encode changes. Keeping
 * them in one exported object means a re-encode touches one line, and the tests
 * can assert that nothing references a name that is no longer on disk.
 *
 * Hashing is what makes `immutable` caching honest: the URL only ever names one
 * byte sequence, so a year-long max-age can never serve a stale frame.
 */
/**
 * The coastal drive, 1920x1080 with a real audio track.
 *
 * ## No WebM, deliberately
 *
 * The previous hero shipped both, and WebM was genuinely the smaller file. On
 * this clip it is not: sparkling water and foliage are close to the worst case
 * for VP9, and every encode tried came out **heavier** than H.264 at
 * comparable quality — 22 MB against 6.1 MB at the closest match. A WebM that
 * loses to its own fallback is worse than no WebM at all, because the browser
 * takes the first source it can play and would download the larger one.
 *
 * So there is one source. If a future encode changes that, add the field back
 * and put it first — the ordering *is* the negotiation.
 *
 * Provenance, and what the transcode cost, are recorded in
 * `docs/MEDIA-PROVENANCE.md`. The published file is a web derivative; the
 * authenticated 44 MB master is kept intact and is not this.
 */
export const HERO_MEDIA = {
  mp4: "/marketing/hero.c7da9646fe.mp4",
  poster: "/marketing/hero-poster.2fc1fb7043.webp",
  posterMobile: "/marketing/hero-poster-mobile.40293fd880.webp",
  /** Seconds. Shown on the showcase card rather than guessed at. */
  durationSeconds: 8,
  /** The source carries an AAC stereo track, so the label is earned. */
  hasAudio: true,
} as const;

/** Below this width the hero is poster-only and no video element is created. */
export const MOBILE_MAX_WIDTH = 767;

export interface Capabilities {
  reducedMotion: boolean;
  saveData: boolean;
  effectiveType?: string;
  viewportWidth: number;
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

/**
 * Should this visitor get the moving background?
 *
 * Pure and exported so the rules can be tested as data rather than by driving a
 * browser. Every branch is a refusal, and every refusal falls back to the
 * poster — which carries the first frame of the loop, so the fold still looks
 * composed rather than empty.
 *
 * The device check is deliberately conservative. Sprint 4.5 shipped a 1080p30
 * loop that cost 232 ms of blocking time on the main thread, and the visitors
 * who feel that are exactly the ones whose hardware reports low numbers here.
 * `hardwareConcurrency <= 2` and `deviceMemory <= 2` are floors, not guesses at
 * a good experience: a normal laptop reports 8 and 8, so this excludes almost
 * nothing that can cope.
 *
 * Missing values mean "capable". `deviceMemory` is absent in Safari and
 * Firefox, and treating absence as low-end would deny the video to most of the
 * non-Chrome web.
 */
export function shouldPlayVideo(capabilities: Capabilities): boolean {
  if (capabilities.reducedMotion) return false;
  if (capabilities.saveData) return false;

  if (
    capabilities.effectiveType === "slow-2g" ||
    capabilities.effectiveType === "2g"
  ) {
    return false;
  }

  // Phones stay on the poster. A full-bleed loop is the least valuable and most
  // expensive thing on a small screen with a metered radio and a warm battery.
  if (capabilities.viewportWidth <= MOBILE_MAX_WIDTH) return false;

  if (
    capabilities.hardwareConcurrency !== undefined &&
    capabilities.hardwareConcurrency <= 2
  ) {
    return false;
  }

  if (
    capabilities.deviceMemory !== undefined &&
    capabilities.deviceMemory <= 2
  ) {
    return false;
  }

  return true;
}

/** Read the current environment. Browser-only; callers guard with an effect. */
export function readCapabilities(): Capabilities {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
      deviceMemory?: number;
    }
  ).connection;

  return {
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches,
    saveData: connection?.saveData === true,
    effectiveType: connection?.effectiveType,
    viewportWidth: window.innerWidth,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number })
      .deviceMemory,
  };
}
