"use client";

import { Clapperboard, Download, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { request } from "@/lib/http";
import {
  stitchClips,
  type StitchProgress,
} from "@/features/sequences/lib/stitch";
import { SoundtrackPanel } from "@/features/sequences/components/soundtrack-panel";

/**
 * Build a long video from many short clips.
 *
 * ## Why the clip count is shown as money and seconds, not as a number
 *
 * Sixteen clips means nothing; "2:00 · 1,440 credits · about 30 minutes" is
 * three facts somebody can decide on. This is the most expensive button in the
 * product — one press can spend a month's allowance — so the cost is stated
 * before the press, in the units the user actually feels.
 *
 * ## The stitch runs here, in the browser
 *
 * Not a design flourish: Vercel's Hobby plan kills a function at 60 seconds and
 * a concat of sixteen clips is not a 60-second job once the clips are moved
 * twice over the network. See `lib/stitch.ts`.
 */

interface SceneState {
  id: string;
  index: number;
  prompt: string;
  generation: {
    status: string;
    progress: number | null;
    error: string | null;
    assets: { id: string; storageKey: string; mimeType: string }[];
  } | null;
}

interface SequenceState {
  id: string;
  title: string | null;
  status: string;
  targetSeconds: number;
  creditsCost: number;
  scenes: SceneState[];
}

const CLIP_SECONDS = 5;
const CREDITS_PER_CLIP = 90;
/**
 * Same-origin, proxied to R2 by a rewrite.
 *
 * The `<video>` previews would work against the bucket's public host directly —
 * media elements do not need CORS — but the stitcher `fetch`es these exact URLs
 * and that does. One path for both, so a preview that plays cannot be a clip
 * that fails to assemble.
 */
function assetUrl(key: string) {
  return `/r2/${key}`;
}

export function SequenceWorkspace() {
  const [title, setTitle] = useState("");
  const [scenes, setScenes] = useState<string[]>(["", ""]);
  const [sequence, setSequence] = useState<SequenceState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [stitching, setStitching] = useState<StitchProgress | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  // The blob itself, because the soundtrack step re-muxes these bytes. An
  // object URL cannot be read back into ffmpeg without fetching it again.
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);

  // Revoked on unmount: an object URL for a 30 MB video that outlives the page
  // is 30 MB the tab never gets back.
  const outputRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (outputRef.current) URL.revokeObjectURL(outputRef.current);
    },
    [],
  );

  const filled = scenes.map((s) => s.trim()).filter(Boolean);
  const totalCredits = filled.length * CREDITS_PER_CLIP;
  const totalSeconds = filled.length * CLIP_SECONDS;

  /** Poll while anything is still rendering. */
  useEffect(() => {
    if (!sequence || sequence.status !== "GENERATING") return;

    const timer = setInterval(async () => {
      try {
        setSequence(
          await request<SequenceState>(`/api/sequences/${sequence.id}`),
        );
      } catch {
        // A dropped poll is not a failed sequence — the clips are rendering on
        // the provider regardless. The next tick picks it up.
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [sequence]);

  async function start() {
    setBusy(true);
    setError("");
    try {
      setSequence(
        await request<SequenceState>("/api/sequences", {
          method: "POST",
          body: JSON.stringify({
            title: title.trim() || undefined,
            modelId: "replicate/video-gen",
            scenes: filled,
            clipSeconds: CLIP_SECONDS,
            aspectRatio: "16:9",
          }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start that.");
    } finally {
      setBusy(false);
    }
  }

  async function stitch() {
    if (!sequence) return;

    // Cut order, and only the clips that actually rendered. A failed scene is
    // skipped rather than blocking the whole assembly — fifteen good clips are
    // worth more than an error message.
    const urls = sequence.scenes
      .filter((scene) => scene.generation?.status === "SUCCEEDED")
      .sort((a, b) => a.index - b.index)
      .map((scene) => scene.generation?.assets[0]?.storageKey)
      .filter((key): key is string => Boolean(key))
      .map(assetUrl);

    if (urls.length === 0) {
      setError("No clips finished, so there is nothing to assemble.");
      return;
    }

    setError("");
    try {
      show(await stitchClips(urls, setStitching));
    } catch (err) {
      setError(
        err instanceof Error
          ? `Assembly failed: ${err.message}`
          : "Assembly failed.",
      );
    } finally {
      setStitching(null);
    }
  }

  /** Replace the preview, releasing the URL the previous one held. */
  function show(blob: Blob) {
    if (outputRef.current) URL.revokeObjectURL(outputRef.current);
    const url = URL.createObjectURL(blob);
    outputRef.current = url;
    setOutputBlob(blob);
    setOutput(url);
  }

  const rendered =
    sequence?.scenes.filter((s) => s.generation?.status === "SUCCEEDED")
      .length ?? 0;

  return (
    <div className="space-y-8">
      {!sequence ? (
        <div className="space-y-4">
          <InputField
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            maxLength={120}
            aria-label="Sequence title"
          />

          <div className="space-y-3">
            {scenes.map((scene, index) => (
              <div key={index} className="flex gap-2">
                <span className="mt-2.5 w-8 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Textarea
                  value={scene}
                  onChange={(e) =>
                    setScenes((prev) =>
                      prev.map((p, i) => (i === index ? e.target.value : p)),
                    )
                  }
                  placeholder={
                    index === 0
                      ? "Opening shot — subject, light, camera move"
                      : "What happens next"
                  }
                  rows={2}
                  className="resize-y"
                />
                {scenes.length > 1 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1"
                    aria-label={`Remove scene ${index + 1}`}
                    onClick={() =>
                      setScenes((prev) => prev.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={scenes.length >= 16}
              onClick={() => setScenes((prev) => [...prev, ""])}
            >
              <Plus />
              Add scene
            </Button>

            {/* Stated before the button, in the units somebody feels. */}
            <p className="text-xs text-muted-foreground tabular-nums">
              {Math.floor(totalSeconds / 60)}:
              {String(totalSeconds % 60).padStart(2, "0")} ·{" "}
              {totalCredits.toLocaleString("en-US")} credits · about{" "}
              {Math.max(1, Math.round((filled.length * 118) / 60))} min to
              render
            </p>
          </div>

          <Button
            size="lg"
            onClick={start}
            disabled={busy || filled.length === 0}
            className="w-full sm:w-auto"
          >
            {busy ? <Loader2 className="animate-spin" /> : <Clapperboard />}
            Generate {filled.length} clip{filled.length === 1 ? "" : "s"}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {rendered} of {sequence.scenes.length} clips ready
            {sequence.status === "GENERATING" ? " — still rendering" : ""}
          </p>

          <ul className="divide-y divide-border rounded-xl border border-border">
            {sequence.scenes.map((scene) => (
              <li key={scene.id} className="flex items-start gap-3 p-3">
                <span className="mt-0.5 w-8 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {String(scene.index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm">{scene.prompt}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {scene.generation?.error ??
                      scene.generation?.status ??
                      "not submitted"}
                  </p>
                </div>
                {scene.generation?.assets[0] ? (
                  <video
                    src={assetUrl(scene.generation.assets[0].storageKey)}
                    className="h-16 w-28 shrink-0 rounded-md object-cover"
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : null}
              </li>
            ))}
          </ul>

          {stitching ? (
            <p className="text-sm text-muted-foreground">
              {stitching.stage === "loading"
                ? "Loading the assembler (31 MB, once per visit)…"
                : stitching.stage === "fetching"
                  ? `Collecting clips… ${Math.round(stitching.ratio * 100)}%`
                  : `Assembling… ${Math.round(stitching.ratio * 100)}%`}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button onClick={stitch} disabled={rendered === 0 || !!stitching}>
              <Clapperboard />
              Assemble {rendered} clip{rendered === 1 ? "" : "s"}
            </Button>

            {output ? (
              <Button variant="outline" asChild>
                <a href={output} download="sequence.mp4">
                  <Download />
                  Download
                </a>
              </Button>
            ) : null}

            <Button variant="ghost" onClick={() => setSequence(null)}>
              New sequence
            </Button>
          </div>

          {output ? (
            <video
              src={output}
              controls
              className="w-full rounded-xl border border-border"
            />
          ) : null}

          {/* Offered only once there is a video to lay it over. Music is the
              thing people change their mind about, so it is a second step at
              20 credits rather than part of a re-render at thousands. */}
          {outputBlob ? (
            <SoundtrackPanel video={outputBlob} onScored={show} />
          ) : null}
        </div>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
