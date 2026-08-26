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
 * ## One model, where there used to be two
 *
 * Music and effects were separate choices, because a music model asked for
 * "a door slamming" returns *music about* a door slamming. The music side is
 * gone on licence grounds, so the picker now has a single option — kept as a
 * list rather than collapsed, because the choice returns if a licensed music
 * model does.
 *
 * ## The mux is a video stream copy
 *
 * Only the audio is encoded. The picture is untouched, so adding a soundtrack
 * costs seconds rather than the re-encode of the whole video it looks like.
 */

/**
 * Only sound effects, for now.
 *
 * The music track was removed when the licence audit found MusicGen's weights
 * are CC-BY-NC-4.0 — non-commercial, which selling a score for 20 credits is
 * not. `services/ai/model-policy.ts` is the authority and refuses the model at
 * submission; this list exists because a client component cannot import a
 * server-only registry, so it has to be kept in agreement by hand. A test
 * asserts it stays that way.
 */
const TRACKS = [
  {
    /**
     * The public id. `/api/generations` refuses a catalogue path outright, so
     * a catalogue path was not merely a leak in the client bundle — it was
     * rejected as `unknown_model` on every submission.
     */
    id: "foley",
    label: "Sound effects",
    icon: AudioLines,
    credits: 10,
    placeholder: "heavy rain on a metal roof, distant thunder",
    seconds: 8,
  },
] as const;

export function SoundtrackPanel({
  video,
  hasAudio,
  onScored,
}: {
  /** The stitched MP4 — silent on the first pass, scored on later ones. */
  video: Blob;
  /** True once a track has been added, so the next one mixes instead of replacing. */
  hasAudio: boolean;
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
      onScored(await muxAudio(video, url, setProgress, hasAudio));
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
          {track.seconds}s of audio.{" "}
          {hasAudio
            ? "Mixed with the track already on the video, not replacing it."
            : "Whichever of picture and sound is longer gets trimmed, so the video never ends on silence."}
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
