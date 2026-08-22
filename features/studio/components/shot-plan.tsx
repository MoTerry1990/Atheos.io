"use client";

import { Clapperboard, Info, Volume2, VolumeX } from "lucide-react";
import { useMemo } from "react";

import {
  buildAudioPlan,
  describeAudioSource,
  type AudioDirectorPlan,
} from "@/services/ai/audio-director";
import {
  buildDirectorPlan,
  compileShots,
  type ProviderShotSupport,
} from "@/services/ai/video-director";
import { cn } from "@/lib/utils";

/**
 * What Atheos is about to direct, shown before the credits are spent.
 *
 * ## Why this is visible rather than internal
 *
 * The director plan changes the video substantially — it can turn one prompt
 * into a four-shot sequence with a fixed sun direction and a soundscape. A user
 * who wanted a single unbroken drone shot and receives cuts has been overruled
 * by software they cannot see. So the plan is stated first, in the words of the
 * result rather than the implementation, and every part of it is reachable from
 * the prompt they wrote.
 *
 * ## The unsupported list is not a footnote
 *
 * Neither video model Atheos ships accepts a shot list; both return one
 * continuous clip. Rendering a confident four-shot plan without saying that
 * would promise something the generation cannot deliver. When the plan collapses
 * the panel says so plainly, above the shot list, not below it.
 */
export function ShotPlanPreview({
  prompt,
  durationSeconds,
  provider,
  className,
}: {
  prompt: string;
  durationSeconds: number;
  provider: ProviderShotSupport;
  className?: string;
}) {
  const { plan, compiled, audio } = useMemo(() => {
    const plan = buildDirectorPlan({ prompt, durationSeconds });
    return {
      plan,
      compiled: compileShots(plan, provider, (shot) => shot.angle),
      audio: buildAudioPlan({
        prompt,
        plan,
        providerHasNativeAudio: provider.supportsNativeAudio,
      }),
    };
  }, [prompt, durationSeconds, provider]);

  // Nothing to preview for an empty field, and a panel of defaults over an
  // empty prompt reads as the product having already decided.
  if (prompt.trim().length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-surface-sunken/50 p-3",
        "space-y-2.5 text-xs",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Clapperboard className="size-3.5" />
        <span className="font-medium text-foreground">
          {durationSeconds} seconds ·{" "}
          {plan.shots.length === 1 ? "1 shot" : `${plan.shots.length} shots`}
        </span>
      </div>

      {/* Above the shot list deliberately: a caveat printed underneath a
          confident-looking sequence is read after the promise has landed. */}
      {compiled.collapsed ? (
        <p className="flex gap-1.5 text-amber-600 dark:text-amber-400">
          <Info className="mt-px size-3.5 shrink-0" />
          <span>
            This model returns one continuous clip, so it will generate the
            establishing shot only. The full sequence would need one generation
            per shot.
          </span>
        </p>
      ) : null}

      <ol className="space-y-1">
        {(compiled.collapsed
          ? compiled.clips.map((c) => c.shot)
          : plan.shots
        ).map((shot, index) => (
          <li key={index} className="flex gap-2 text-muted-foreground">
            <span className="text-muted-foreground/70 tabular-nums">
              {shot.start.toFixed(1)}–{shot.end.toFixed(1)}s
            </span>
            <span className="text-foreground">{shot.angle}</span>
          </li>
        ))}
      </ol>

      <p className="flex items-center gap-1.5 text-muted-foreground">
        {audio.source === "muted" ? (
          <VolumeX className="size-3.5" />
        ) : (
          <Volume2 className="size-3.5" />
        )}
        {/*
         * The exact wording from `describeAudioSource`, not a shortened version
         * of it. "Soundscape added by Atheos" says who made the sound; "Audio"
         * would let a user believe the model produced it.
         */}
        {describeAudioSource(audio.source)}
      </p>
    </div>
  );
}

export type { AudioDirectorPlan };
