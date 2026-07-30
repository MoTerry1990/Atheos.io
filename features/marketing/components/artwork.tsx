import { cn } from "@/lib/utils";

/**
 * Procedural artwork.
 *
 * Deterministic gradient-mesh tiles generated from a hue and a seed. Used
 * anywhere the page needs to *suggest* generated imagery.
 *
 * ## Why not real images
 *
 * Two options were available and both were rejected. Shipping stock photography
 * dressed up as model output misrepresents a product that has not generated
 * anything yet. Shipping real AI output would require having generated it,
 * which is Sprint 4's job. Abstract procedural art is the honest third option:
 * it is unmistakably decorative, it costs zero bytes of image payload, and it
 * cannot be mistaken for a product claim.
 *
 * These are replaced by real generations once the pipeline exists.
 *
 * ## Why it is deterministic
 *
 * The seed drives every value, so a tile renders identically on the server and
 * the client. `Math.random()` here would produce a different composition in each
 * and hydrate with a mismatch — and would also change on every reload, which
 * makes the page feel unstable rather than alive.
 */

/** Small deterministic PRNG. Same seed, same picture, every time. */
function seeded(seed: number) {
  let state = seed * 9301 + 49297;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

export interface ArtworkProps {
  hue: number;
  seed?: number;
  className?: string;
  /** Adds a subtle vignette and grain — for large feature panels. */
  rich?: boolean;
}

export function Artwork({ hue, seed = 7, className, rich }: ArtworkProps) {
  const rand = seeded(seed);

  const blobs = Array.from({ length: 4 }, (_, i) => ({
    x: Math.round(rand() * 100),
    y: Math.round(rand() * 100),
    size: 45 + Math.round(rand() * 45),
    hue: hue + (i - 1.5) * 26,
    alpha: 0.55 - i * 0.09,
  }));

  const layers = blobs
    .map(
      (b) =>
        `radial-gradient(${b.size}% ${b.size}% at ${b.x}% ${b.y}%, ` +
        `oklch(0.68 0.22 ${b.hue} / ${b.alpha.toFixed(2)}), transparent 70%)`,
    )
    .join(", ");

  return (
    <div
      aria-hidden
      className={cn("relative overflow-hidden rounded-xl", className)}
      style={{
        // Dark base underneath so the blobs read as emitted light rather than
        // as paint. Colour on black is the whole visual language here.
        backgroundColor: "oklch(0.14 0.02 300)",
        backgroundImage: layers,
      }}
    >
      {rich ? (
        <>
          <div className="absolute inset-0 grain opacity-20 mix-blend-overlay" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,oklch(0_0_0/0.45))]" />
        </>
      ) : null}
    </div>
  );
}
