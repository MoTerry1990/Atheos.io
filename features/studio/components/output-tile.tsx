"use client";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { JobOutput } from "@/features/studio/types";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * A generated output.
 *
 * **The imagery is procedural, not model output.** No provider is connected
 * until Sprint 6. Rendering something that looked like a real generation would
 * misrepresent the product to anyone reviewing it, so these are unmistakably
 * gradients — and the studio carries a banner saying so.
 *
 * What is real here is everything around the pixels: the aspect ratio comes
 * from the requested dimensions, the seed is displayed, and the download
 * genuinely produces a file at the requested resolution. When a provider
 * arrives, an `<img>` replaces the gradient and nothing else in this component
 * changes.
 */

function gradientFor(output: JobOutput): string {
  const { hue } = output;
  return [
    `radial-gradient(120% 120% at 25% 20%, oklch(0.72 0.2 ${hue} / 0.85), transparent 65%)`,
    `radial-gradient(100% 100% at 80% 75%, oklch(0.6 0.22 ${(hue + 55) % 360} / 0.7), transparent 60%)`,
    `radial-gradient(90% 90% at 60% 10%, oklch(0.8 0.16 ${(hue + 300) % 360} / 0.45), transparent 55%)`,
  ].join(", ");
}

/**
 * Render the placeholder to a canvas and download it.
 *
 * Deliberately produced at the **requested** dimensions rather than the
 * displayed ones, so the download pipeline — filename, MIME type, object-URL
 * lifecycle, the size the user actually asked for — is exercised now rather
 * than written blind in Sprint 6.
 */
async function downloadOutput(output: JobOutput, label: string) {
  const canvas = document.createElement("canvas");
  canvas.width = output.width;
  canvas.height = output.height;

  const context = canvas.getContext("2d");
  if (!context) {
    toast.error("Could not prepare the download");
    return;
  }

  const gradient = context.createLinearGradient(
    0,
    0,
    canvas.width,
    canvas.height,
  );
  gradient.addColorStop(0, `hsl(${output.hue} 70% 55%)`);
  gradient.addColorStop(0.5, `hsl(${(output.hue + 55) % 360} 65% 40%)`);
  gradient.addColorStop(1, `hsl(${(output.hue + 300) % 360} 60% 20%)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Stamped so a downloaded file cannot be mistaken for real output once it
  // has left the app and lost its surrounding context.
  context.fillStyle = "rgba(255,255,255,0.75)";
  context.font = `${Math.max(12, Math.round(canvas.width / 40))}px sans-serif`;
  context.fillText(
    "Atheos placeholder — no provider connected",
    Math.round(canvas.width * 0.04),
    Math.round(canvas.height * 0.94),
  );

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) {
    toast.error("Could not prepare the download");
    return;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `atheos-${label}-${output.seed}.png`;
  anchor.click();
  // Revoke on the next tick — revoking synchronously can cancel the download
  // in some browsers before it has started reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  toast.success("Download started", anchor.download);
}

export function OutputTile({
  output,
  label,
  className,
  showActions = true,
}: {
  output: JobOutput;
  label: string;
  className?: string;
  showActions?: boolean;
}) {
  return (
    <figure
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border",
        className,
      )}
      style={{ aspectRatio: `${output.width} / ${output.height}` }}
    >
      {/* The gradient is the backdrop, not the picture. It shows while the
          real asset loads and remains visible if the CDN is unreachable, so a
          slow image is never an empty grey box. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundColor: "oklch(0.14 0.02 300)",
          backgroundImage: gradientFor(output),
        }}
      />

      {output.url ? (
        /* eslint-disable-next-line @next/next/no-img-element --
           Asset hosts are configured per deployment, so next/image would need
           every possible R2 hostname in remotePatterns at build time. The
           objects are already immutable and CDN-cached, which is most of what
           the optimiser would provide. */
        <img
          src={output.url}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      <div
        className="absolute inset-0 grain opacity-15 mix-blend-overlay"
        aria-hidden
      />

      {showActions ? (
        <figcaption
          className={cn(
            "absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2",
            "bg-gradient-to-t from-black/70 to-transparent",
            "translate-y-full transition-transform duration-200",
            "group-focus-within:translate-y-0 group-hover:translate-y-0",
            "motion-reduce:translate-y-0",
          )}
        >
          <span className="font-mono text-2xs text-white/80 tabular-nums">
            {output.width}×{output.height} · seed {output.seed}
          </span>
          <Button
            size="icon-xs"
            variant="secondary"
            onClick={() => downloadOutput(output, label)}
            aria-label="Download"
            title="Download"
          >
            <Download />
          </Button>
        </figcaption>
      ) : null}
    </figure>
  );
}

export { downloadOutput };
