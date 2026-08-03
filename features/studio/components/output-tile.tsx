"use client";

import { Download } from "lucide-react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import type { JobOutput } from "@/features/studio/types";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * A generated output — a still or a clip.
 *
 * ## The type of the file decides what is mounted
 *
 * Not the model's modality, and not the storage key's extension. A video model
 * can return a poster frame, and the mock provider returns an animated SVG for
 * a clip because encoding a real MP4 server-side to stand in for one nobody
 * watches is not worth an ffmpeg dependency. Mounting a `<video>` over a file
 * that is not one produces a black rectangle with a broken control bar, so the
 * asset's own MIME type is the only signal used here.
 *
 * ## The gradient is a backdrop, not the picture
 *
 * It shows while the asset loads and stays visible if the CDN is unreachable,
 * so a slow file is never an empty grey box. In Sprint 5 it *was* the picture,
 * clearly labelled as such; with providers connected it has receded to what it
 * always should have been.
 */

function gradientFor(output: JobOutput): string {
  const { hue } = output;
  return [
    `radial-gradient(120% 120% at 25% 20%, oklch(0.72 0.2 ${hue} / 0.85), transparent 65%)`,
    `radial-gradient(100% 100% at 80% 75%, oklch(0.6 0.22 ${(hue + 55) % 360} / 0.7), transparent 60%)`,
    `radial-gradient(90% 90% at 60% 10%, oklch(0.8 0.16 ${(hue + 300) % 360} / 0.45), transparent 55%)`,
  ].join(", ");
}

export function isVideoOutput(output: JobOutput): boolean {
  return output.mimeType.startsWith("video/");
}

function formatDuration(durationMs: number): string {
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Download an output.
 *
 * Goes through `/api/assets/{id}/download`, which checks ownership and then
 * redirects to a presigned URL carrying the attachment header. It does **not**
 * link straight to the CDN: the `download` attribute is ignored cross-origin,
 * so that would open the file in the tab — playing the video, or replacing the
 * app with the image — rather than saving it.
 *
 * An anchor click rather than `fetch` or `location.href`. The browser follows
 * the redirect, sees `Content-Disposition: attachment`, saves the file and
 * leaves the page where it is — no bytes pass through JavaScript, which matters
 * when the file is a 50MB clip, and unlike `location.href` it can be called
 * several times to save a batch.
 */
function downloadOutput(output: JobOutput) {
  if (!output.url) {
    toast.error("Nothing to download", {
      description: "This result was not stored — file storage is unconfigured.",
    });
    return;
  }

  const anchor = document.createElement("a");
  anchor.href = `/api/assets/${output.id}/download`;
  // The server names the file; this only signals intent to the browser so it
  // does not treat the request as navigation.
  anchor.download = "";
  anchor.rel = "noopener";
  anchor.click();
}

export function OutputTile({
  output,
  className,
  showActions = true,
}: {
  output: JobOutput;
  className?: string;
  showActions?: boolean;
}) {
  const video = isVideoOutput(output);

  return (
    <figure
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border",
        className,
      )}
      style={{ aspectRatio: `${output.width} / ${output.height}` }}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundColor: "oklch(0.14 0.02 300)",
          backgroundImage: gradientFor(output),
        }}
      />

      {output.url ? (
        video ? (
          <video
            src={output.url}
            className="absolute inset-0 size-full object-cover"
            // Controls, because this is the result the user paid for and they
            // will want to scrub it. Muted and playsInline so autoplay is
            // permitted at all — a browser blocks an unmuted autoplay, and iOS
            // takes an un-inlined video fullscreen without asking.
            controls
            loop
            muted
            playsInline
            autoPlay
            // `metadata` rather than `auto`: the tile may be one of several in
            // a grid, and preloading four clips in full is a lot of somebody's
            // bandwidth for a panel they have not looked at yet.
            preload="metadata"
          />
        ) : (
          /* The per-deployment-hostname problem that kept this a raw `<img>`
             is solved in next.config.ts: the bucket's public host comes from
             `NEXT_PUBLIC_R2_PUBLIC_URL`, which is known at build time.
             Immutable CDN caching was most of what the optimiser provides —
             but not the responsive variants, which is the part that matters in
             a grid. */
          <Image
            src={output.url}
            alt=""
            fill
            sizes="(max-width: 640px) 50vw, 280px"
            className="absolute inset-0 size-full object-cover"
          />
        )
      ) : null}

      {/* Skipped over video: the grain sits above the element and would swallow
          clicks on the native control bar. */}
      {video ? null : (
        <div
          className="absolute inset-0 grain opacity-15 mix-blend-overlay"
          aria-hidden
        />
      )}

      {showActions ? (
        <figcaption
          className={cn(
            "absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2",
            "bg-gradient-to-t from-black/70 to-transparent",
            "translate-y-full transition-transform duration-200",
            "group-focus-within:translate-y-0 group-hover:translate-y-0",
            "motion-reduce:translate-y-0",
            // A video's own controls live along the bottom edge. Lifting the
            // caption clear of them keeps both usable.
            video && "bottom-12 bg-none",
          )}
        >
          <span className="font-mono text-2xs text-white/80 tabular-nums">
            {output.width}×{output.height}
            {output.durationMs ? ` · ${formatDuration(output.durationMs)}` : ""}
            {output.seed ? ` · seed ${output.seed}` : ""}
          </span>
          <Button
            size="icon-xs"
            variant="secondary"
            onClick={() => downloadOutput(output)}
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
