"use client";

import { AudioLines, Loader2, Music } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { pollUntilSettled, submitGeneration } from "@/features/studio/lib/api";
import { muxAudio, type StitchProgress } from "@/features/sequences/lib/stitch";
import { cn } from "@/lib/utils";

/**
 * Generate a soundtrack and lay it over a finished sequence.
 *
 * ## Why this is a second step rather than part of the render
 *
 * Music is the thing people change their mind about. Baking it into the clip
 * render would mean regenerating sixteen video clips — thousands of credits —
 * because somebody wanted the score less tense. Here the video is already
 * assembled and only the audio is re-made, at 20 credits a go.
 *
 * ## Two models, because one would be wrong half the time
 *
 * musicgen asked for "a door slamming" returns *music about* a door slamming.
 * Score and Foley are different models for genuinely different jobs, so the
 * choice is put to the user rather than guessed from the prompt.
 *
 * ## The mux is a video stream copy
 *
 * Only the audio is encoded. The picture is untouched, so adding a soundtrack
 * costs seconds rather than the re-encode of the whole video it looks like.
 */

const TRACKS = [
  {
    id: "replicate/music",
    label: "Music",
    icon: Music,
    credits: 20,
    placeholder: "slow cinematic strings, tense, building",
    /** Longest musicgen step that still fits a two-minute sequence. */
    seconds: 30,
  },
  {
    id: "replicate/sfx",
    label: "Sound effects",
    icon: AudioLines,
    credits: 10,
    placeholder: "heavy rain on a metal roof, distant thunder",
    seconds: 8,
  },
] as const;

export function SoundtrackPanel({
  video,
  onScored,
}: {
  /** The stitched, silent MP4. */
  video: Blob;
  onScored: (scored: Blob) => void;
}) {
  const [track, setTrack] = useState<(typeof TRACKS)[number]>(TRACKS[0]);
  const [prompt, setPrompt] = useState("");
  const [stage, setStage] = useState<"idle" | "generating" | "mixing">("idle");
  const [progress, setProgress] = useState<StitchProgress | null>(null);
  const [error, setError] = useState("");

  async function run() {
    if (!prompt.trim()) return;

    setError("");
    setStage("generating");

    try {
      const { generationId } = await submitGeneration({
        operation: "text-to-audio",
        modelId: track.id,
        prompt: prompt.trim(),
        durationSeconds: track.seconds,
        outputs: 1,
      });

      const settled = await pollUntilSettled(generationId);

      // Lower-case in the DTO — the studio's vocabulary, not the database's.
      if (settled.status !== "succeeded") {
        // The credits are already back — the refund happens in the same
        // transaction that records the failure, not on request.
        setError(
          settled.error ??
            "That track did not render. The credits have been refunded.",
        );
        return;
      }

      // `outputs` carries a storage key rather than a URL; the CDN hostname is
      // an operational detail the DTO deliberately keeps out.
      const key = settled.outputs[0]?.storageKey;
      // Same-origin proxy, because muxAudio fetches it and the bucket has no
      // CORS policy. See next.config.ts.
      const url = key ? `/r2/${key}` : null;
      if (!url) {
        setError("The track rendered with no file, which is a bug. Tell us.");
        return;
      }

      setStage("mixing");
      onScored(await muxAudio(video, url, setProgress));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not add the soundtrack.",
      );
    } finally {
      setStage("idle");
      setProgress(null);
    }
  }

  const busy = stage !== "idle";

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <p className="text-sm font-medium">Add a soundtrack</p>

      <div className="flex gap-2">
        {TRACKS.map((option) => {
          const Icon = option.icon;
          const selected = option.id === track.id;
          return (
            <Button
              key={option.id}
              type="button"
              size="sm"
              variant={selected ? "default" : "outline"}
              disabled={busy}
              onClick={() => setTrack(option)}
              className={cn(!selected && "text-muted-foreground")}
            >
              <Icon />
              {option.label}
            </Button>
          );
        })}
      </div>

      <Textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={track.placeholder}
        rows={2}
        className="resize-y"
        aria-label="Soundtrack prompt"
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={run} disabled={busy || !prompt.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Music />}
          {stage === "generating"
            ? "Composing…"
            : stage === "mixing"
              ? `Mixing… ${Math.round((progress?.ratio ?? 0) * 100)}%`
              : `Add — ${track.credits} credits`}
        </Button>

        <p className="text-xs text-muted-foreground">
          {track.seconds}s of audio. Whichever of picture and sound is longer
          gets trimmed, so the video never ends on silence.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
