"use client";

import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import type { ShowcaseTab } from "@/features/marketing/content";
import { cn } from "@/lib/utils";

/**
 * The media beside each showcase panel.
 *
 * ## Why only one can ever be playing
 *
 * The panel is keyed on the tab id in `ai-showcase.tsx`, so switching tabs
 * unmounts the whole subtree. React tears the `<video>` or `<audio>` element
 * down with it, and a destroyed element cannot keep playing — the rule is
 * enforced by the tree rather than by a listener that has to remember to fire.
 * That also resets position and mute state, because the next mount starts from
 * the component's initial state.
 *
 * ## Nothing is fetched until its tab is open
 *
 * Same mechanism. The element for a tab that has never been opened does not
 * exist, so its file is never requested. The image tab is the default and is
 * the only one that costs anything on first paint.
 *
 * ## The frame
 *
 * A single rounded container with a hairline ring, shared by all three, so the
 * three tabs read as one surface rather than three unrelated widgets. Aspect
 * ratio is fixed per media so switching tabs does not resize the column.
 */

/** Shared chrome for every control in here. */
const CONTROL =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-border/60 bg-background/80 px-4 text-sm font-medium text-foreground backdrop-blur-sm transition-colors hover:bg-background focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none";

const FRAME =
  "relative overflow-hidden rounded-xl bg-surface-sunken ring-1 ring-white/10";

export function ShowcaseMedia({ panel }: { panel: ShowcaseTab }) {
  if (panel.video) return <ShowcaseVideo panel={panel} />;
  if (panel.audio) return <ShowcaseAudio panel={panel} />;
  return <ShowcaseStill panel={panel} />;
}

/* -------------------------------------------------------------------------- */
/* Image                                                                       */
/* -------------------------------------------------------------------------- */

function ShowcaseStill({ panel }: { panel: ShowcaseTab }) {
  return (
    <figure className="space-y-3">
      <div className={cn(FRAME, "aspect-[16/9]")}>
        <Image
          src={`/marketing/${panel.image}.webp`}
          alt={`AI generation: ${panel.mediaCaption}`}
          fill
          sizes="(max-width: 1024px) 100vw, 50vw"
          /**
           * 90, not the default 75. The source is already compressed WebP and
           * re-encoding it at 75 compounds the loss — which is what soft
           * marketing imagery is made of.
           */
          quality={90}
          className="object-cover"
        />
      </div>
      <figcaption className="text-xs text-muted-foreground">
        {panel.mediaCaption}
      </figcaption>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* Video                                                                       */
/* -------------------------------------------------------------------------- */

function ShowcaseVideo({ panel }: { panel: ShowcaseTab }) {
  const video = panel.video!;
  const ref = useRef<HTMLVideoElement>(null);

  /**
   * Both follow the element rather than leading it.
   *
   * Autoplay can be refused, a tab switch can pause, and a user can use the
   * native context menu. Anything that reads local state to describe the
   * element ends up describing something that is not happening.
   */
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const sync = () => {
      setPlaying(!element.paused);
      setMuted(element.muted);
    };
    for (const event of ["play", "pause", "volumechange"]) {
      element.addEventListener(event, sync);
    }
    sync();

    return () => {
      for (const event of ["play", "pause", "volumechange"]) {
        element.removeEventListener(event, sync);
      }
    };
  }, []);

  /** Turning sound on also starts it, because that is what the label promises. */
  function toggleSound() {
    const element = ref.current;
    if (!element) return;

    element.muted = !element.muted;
    if (!element.muted) void element.play().catch(() => undefined);
  }

  function togglePlay() {
    const element = ref.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => undefined);
    else element.pause();
  }

  return (
    <figure className="space-y-3">
      <div className={cn(FRAME, "aspect-[16/9]")}>
        <video
          ref={ref}
          poster={video.poster}
          // Muted autoplay is the only autoplay a browser permits, and the
          // loop is a ping-pong so it does not cut on repeat.
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={video.label}
          className="size-full object-cover"
        >
          <source src={video.src} type="video/mp4" />
        </video>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          className={CONTROL}
          aria-label={playing ? "Pause video" : "Play video"}
        >
          {playing ? (
            <Pause className="size-4" aria-hidden />
          ) : (
            <Play className="size-4" aria-hidden />
          )}
          {playing ? "Pause" : "Play"}
        </button>

        {/**
         * The state is in the accessible name, not only in the icon.
         * "Play with sound" alone never tells a screen-reader user whether
         * sound is currently on.
         */}
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={!muted}
          aria-label={
            muted ? "Play with sound — currently muted" : "Mute — sound is on"
          }
          className={CONTROL}
        >
          {muted ? (
            <Volume2 className="size-4" aria-hidden />
          ) : (
            <VolumeX className="size-4" aria-hidden />
          )}
          {muted ? "Play with sound" : "Mute"}
        </button>
      </div>

      {/**
       * The claim, stated exactly.
       *
       * The picture is model output; the sound is a separately generated Foley
       * ambience mixed in locally. No model in the catalogue that is approved
       * for commercial publication generates audio, so calling this "native
       * audio" would be false. `docs/SHOWCASE-PROVENANCE.md` carries both
       * source hashes.
       */}
      <figcaption className="text-xs text-muted-foreground">
        {panel.mediaCaption}
      </figcaption>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* Audio                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A fixed bar pattern, drawn once.
 *
 * Deliberately not a real waveform analysis: `AudioContext` requires a user
 * gesture to start, decoding the file to sample it costs a second download, and
 * neither buys anything a listener can use. What the bars do is show *progress*
 * — the ones behind the playhead are lit — which is information. A decorative
 * animation that ignored playback would be the thing this replaces.
 */
const BARS = [
  38, 52, 30, 64, 46, 78, 58, 40, 70, 52, 88, 62, 44, 74, 56, 36, 66, 48, 80,
  60, 42, 72, 54, 34, 68, 50, 82, 58, 40, 62, 46, 76, 54, 38, 64, 48,
];

function ShowcaseAudio({ panel }: { panel: ShowcaseTab }) {
  const audio = panel.audio!;
  const ref = useRef<HTMLAudioElement>(null);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(audio.seconds);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const sync = () => {
      setPlaying(!element.paused);
      setMuted(element.muted);
      setVolume(element.volume);
      setCurrent(element.currentTime);
      if (Number.isFinite(element.duration) && element.duration > 0) {
        setTotal(element.duration);
      }
    };
    const events = [
      "play",
      "pause",
      "timeupdate",
      "volumechange",
      "loadedmetadata",
      "ended",
    ];
    for (const event of events) element.addEventListener(event, sync);
    sync();

    return () => {
      for (const event of events) element.removeEventListener(event, sync);
    };
  }, []);

  const progress = total > 0 ? Math.min(1, current / total) : 0;

  function toggle() {
    const element = ref.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => undefined);
    else element.pause();
  }

  function seek(fraction: number) {
    const element = ref.current;
    if (!element || !Number.isFinite(element.duration)) return;
    element.currentTime = element.duration * Math.min(1, Math.max(0, fraction));
  }

  return (
    <figure className="space-y-4">
      <div
        className={cn(FRAME, "flex aspect-[16/9] flex-col justify-between p-6")}
      >
        <div>
          <h3 className="text-base font-medium text-foreground">
            {audio.title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {audio.description}
          </p>
        </div>

        {/**
         * The bars are decoration and the slider is the control.
         *
         * `aria-hidden` on the bars, a real `<input type="range">` underneath:
         * a div with click handlers cannot be dragged with a keyboard, and
         * seeking is exactly the interaction a keyboard user needs.
         */}
        <div className="space-y-3">
          <div
            aria-hidden
            className="flex h-16 items-end gap-[3px]"
            data-testid="showcase-waveform"
          >
            {BARS.map((height, index) => (
              <span
                key={index}
                style={{ height: `${height}%` }}
                className={cn(
                  "flex-1 rounded-full transition-colors duration-150",
                  index / BARS.length <= progress
                    ? "bg-primary"
                    : "bg-muted-foreground/25",
                )}
              />
            ))}
          </div>

          <label className="block">
            <span className="sr-only">Seek</span>
            <input
              type="range"
              min={0}
              max={1000}
              value={Math.round(progress * 1000)}
              onChange={(event) => seek(Number(event.target.value) / 1000)}
              aria-label="Seek"
              aria-valuetext={`${formatTime(current)} of ${formatTime(total)}`}
              className="w-full accent-primary"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={toggle}
              className={CONTROL}
              aria-label={playing ? "Pause audio" : "Play audio"}
            >
              {playing ? (
                <Pause className="size-4" aria-hidden />
              ) : (
                <Play className="size-4" aria-hidden />
              )}
              {playing ? "Pause" : "Play"}
            </button>

            {/* Monospaced so the row does not jitter as the digits change. */}
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {formatTime(current)} / {formatTime(total)}
            </span>

            <button
              type="button"
              onClick={() => {
                const element = ref.current;
                if (element) element.muted = !element.muted;
              }}
              aria-pressed={muted}
              aria-label={muted ? "Unmute — currently muted" : "Mute"}
              className={cn(CONTROL, "px-3")}
            >
              {muted ? (
                <VolumeX className="size-4" aria-hidden />
              ) : (
                <Volume2 className="size-4" aria-hidden />
              )}
            </button>

            <label className="flex flex-1 items-center gap-2">
              <span className="sr-only">Volume</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((muted ? 0 : volume) * 100)}
                onChange={(event) => {
                  const element = ref.current;
                  if (!element) return;
                  element.volume = Number(event.target.value) / 100;
                  // Moving the slider off zero is an unmute request.
                  if (element.volume > 0) element.muted = false;
                }}
                aria-label="Volume"
                className="w-full min-w-24 accent-primary"
              />
            </label>
          </div>
        </div>

        {/* No `autoPlay`. Sound that starts because a tab opened is the thing
            every visitor resents. */}
        <audio ref={ref} preload="metadata" src={audio.src} />
      </div>

      <figcaption className="text-xs text-muted-foreground">
        {panel.mediaCaption}
      </figcaption>
    </figure>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
