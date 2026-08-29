"use client";

import {
  Clapperboard,
  Film,
  Info,
  Layers,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useMemo } from "react";

import {
  buildAudioPlan,
  describeAudioSource,
  type AudioDirectorPlan,
} from "@/services/ai/audio-director";
import {
  quoteSequence,
  type SequenceMode,
  type SequenceModelFacts,
  type SequenceQuote,
} from "@/services/ai/sequence";
import { buildDirectorPlan } from "@/services/ai/video-director";
import { cn } from "@/lib/utils";

/**
 * What Atheos is about to make, priced, before any credits are spent.
 *
 * ## Why this replaced a warning
 *
 * The first version of this panel planned four shots, then said: "this model
 * returns one continuous clip, so it will generate the establishing shot only."
 * Underneath it the button read **Generate · 90 credits**. Both sentences were
 * true and the pair was a lie — 90 credits bought a quarter of what the panel
 * had just described, and the substitution was made by software rather than by
 * the person paying.
 *
 * A user asking for four angles has to choose between two different things with
 * two different prices, and has to be told what each one costs before choosing.
 * That is all this panel is.
 *
 * ## What the audit found
 *
 * Seven video models read from their own schemas on 2026-08-22. Not one accepts
 * a shot list; every one returns a single continuous clip. There is no model to
 * route a four-shot request to, so a sequence is four generations, billed four
 * times — and on a model with no image input the shots cannot even hold the same
 * car between them, which is why Motion 1 refuses outright rather than offering
 * a worse version.
 */

export function ShotPlanPreview({
  prompt,
  durationSeconds,
  facts,
  baseCredits,
  mode,
  onModeChange,
  hasReferenceImage,
  requestedResolution,
  multiShotAvailable = false,
  className,
}: {
  prompt: string;
  durationSeconds: number;
  /**
   * The model's base price in credits, from the public model DTO.
   *
   * Passed down rather than looked up. The price used to come from the same
   * static table as the capabilities, which ships to the browser; it now comes
   * from `/api/generations`, which computes it server-side per request.
   */
  baseCredits: number;
  /** The selected model's real capabilities. See `sequence-models.public.ts`. */
  facts: SequenceModelFacts;
  mode: SequenceMode;
  onModeChange: (next: SequenceMode) => void;
  hasReferenceImage?: boolean;
  requestedResolution?: string;
  /**
   * Whether Atheos can actually run a sequence yet. **Default false.**
   *
   * The quote above is real and the orchestrator is not: nothing yet submits
   * four calls, chains their frames, validates continuity and assembles the
   * result. Letting the mode be *chosen* while that is true would put
   * "Generate 4-shot sequence · 720 credits" on a button that submits one call
   * — a new version of the same lie, pointing the other way.
   *
   * So the card shows its full price and says it is not available yet, which is
   * the information a user needs to decide whether to wait for it.
   */
  multiShotAvailable?: boolean;
  className?: string;
}) {
  const { plan, continuous, directed, sequence } = useMemo(() => {
    const plan = buildDirectorPlan({ prompt, durationSeconds });
    const common = {
      plan,
      facts,
      baseCredits,
      hasReferenceImage,
      requestedResolution,
      wantsAudio: /\b(con audio|con sonido|with (audio|sound))\b/i.test(prompt),
    };
    return {
      plan,
      continuous: quoteSequence({ ...common, mode: "continuous" as const }),
      directed: quoteSequence({ ...common, mode: "directed" as const }),
      sequence: quoteSequence({ ...common, mode: "multi_shot" as const }),
    };
  }, [
    prompt,
    durationSeconds,
    facts,
    baseCredits,
    hasReferenceImage,
    requestedResolution,
  ]);

  const audio = useMemo(
    () =>
      buildAudioPlan({
        prompt,
        plan,
        providerHasNativeAudio: facts.nativeAudio,
      }),
    [prompt, plan, facts.nativeAudio],
  );

  // A panel of defaults over an empty field reads as the product having already
  // decided what to make.
  if (prompt.trim().length === 0) return null;

  // Nothing to choose between when the prompt asked for one unbroken take.
  const multiShotWasPlanned = plan.shots.length > 1;

  return (
    <div className={cn("space-y-2", className)}>
      {multiShotWasPlanned ? (
        <p className="text-xs text-muted-foreground">
          This prompt describes {plan.shots.length} camera angles. Choose what
          to generate:
        </p>
      ) : null}

      <ModeCard
        icon={<Clapperboard className="size-3.5" />}
        title="Continuous single shot"
        quote={continuous}
        audioLabel={describeAudioSource(audio.source)}
        selected={mode === "continuous"}
        onSelect={() => onModeChange("continuous")}
        shots={["The whole scene as one unbroken take."]}
      />

      {/*
       * Directed sits above the chained path deliberately. It is one call, one
       * price, one wait and — on a Veo tier — native audio, so it is the option
       * most people want. Putting the 47-minute four-call path first would make
       * the expensive fallback read as the normal way to do this.
       */}
      {multiShotWasPlanned ? (
        <ModeCard
          icon={<Film className="size-3.5" />}
          title="Directed camera movement"
          quote={directed}
          audioLabel={describeAudioSource(audio.source)}
          selected={mode === "directed"}
          onSelect={() => onModeChange("directed")}
          shots={directed.beats.map(
            (beat) =>
              `${beat.start.toFixed(1)}–${beat.end.toFixed(1)}s · ${beat.label}`,
          )}
        />
      ) : null}

      {multiShotWasPlanned ? (
        <ModeCard
          icon={<Layers className="size-3.5" />}
          title={`Advanced chained sequence (${plan.shots.length} calls)`}
          quote={sequence}
          audioLabel={describeAudioSource(audio.source)}
          selected={mode === "multi_shot"}
          onSelect={() => onModeChange("multi_shot")}
          unavailableNote={
            multiShotAvailable
              ? undefined
              : "Not available yet — the shot-by-shot orchestrator is not built. The price above is what it will cost."
          }
          shots={plan.shots.map(
            (shot) =>
              `${shot.start.toFixed(1)}–${shot.end.toFixed(1)}s · ${shot.angle}`,
          )}
        />
      ) : null}
    </div>
  );
}

function ModeCard({
  icon,
  title,
  quote,
  audioLabel,
  selected,
  onSelect,
  shots,
  unavailableNote,
}: {
  icon: React.ReactNode;
  title: string;
  quote: SequenceQuote;
  audioLabel: string;
  selected: boolean;
  onSelect: () => void;
  shots: string[];
  /** Shown, and makes the card unselectable, without hiding its price. */
  unavailableNote?: string;
}) {
  // A model that cannot do it at all, versus one that can but for which Atheos
  // has not built the pipeline. Different sentences, same refusal to charge.
  const blocked = quote.blockers.length > 0;
  const selectable = !blocked && !unavailableNote;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!selectable}
      aria-pressed={selected}
      className={cn(
        "block w-full rounded-lg border p-3 text-left text-xs transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        selected
          ? "border-brand bg-surface-sunken"
          : "border-border/60 bg-surface-sunken/40 hover:border-border",
        !selectable && "cursor-not-allowed opacity-70",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium text-foreground">
          {icon}
          {title}
        </span>
        {!blocked ? (
          <span className="text-foreground tabular-nums">
            {quote.creditCharge.toLocaleString("en-US")} credits
          </span>
        ) : null}
      </div>

      {/* Above everything else. A refusal printed under a shot list is read
          after the promise has already landed. */}
      {blocked ? (
        <p className="mt-2 flex gap-1.5 text-amber-600 dark:text-amber-400">
          <Info className="mt-px size-3.5 shrink-0" />
          <span>{quote.blockers.join(" ")}</span>
        </p>
      ) : (
        <>
          <ol className="mt-2 space-y-0.5 text-muted-foreground">
            {shots.map((shot, index) => (
              <li key={index}>{shot}</li>
            ))}
          </ol>

          {/*
           * The disclosure. Every number here is what will actually happen:
           * calls billed, seconds generated versus seconds delivered, the
           * resolution the provider returns rather than the one a dropdown
           * offers, and the wait.
           */}
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
            <Fact label="Provider calls" value={String(quote.providerCalls)} />
            <Fact
              label="Generated"
              value={`${quote.generatedSeconds}s (${quote.clipDurationsSeconds.join(" + ")})`}
            />
            <Fact
              label="Final video"
              value={`${quote.assembledDurationSeconds}s · ${quote.frameRate}fps`}
            />
            <Fact label="Resolution" value={quote.exportResolution} />
            {/*
              The "Provider cost" row was here, showing what Atheos pays per
              generation in USD. A customer reading it alongside the credit
              price can compute the markup on their own work, which is not
              theirs to have — and rendering it is why our per-second cost had
              to travel to the browser at all. Both are gone.
            */}
            <Fact
              label="Estimated wait"
              value={`~${Math.round(quote.estimatedSeconds / 60)} min`}
            />
          </dl>

          {unavailableNote ? (
            <p className="mt-2 flex gap-1.5 text-amber-600 dark:text-amber-400">
              <Info className="mt-px size-3.5 shrink-0" />
              <span>{unavailableNote}</span>
            </p>
          ) : null}

          <p className="mt-2 flex items-center gap-1.5 text-muted-foreground">
            {quote.audio === "none" ? (
              <VolumeX className="size-3.5" />
            ) : (
              <Volume2 className="size-3.5" />
            )}
            {audioLabel}
          </p>

          {quote.continuityLimitations.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-muted-foreground/80">
              {quote.continuityLimitations.map((limitation, index) => (
                <li key={index}>— {limitation}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </button>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground/70">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </>
  );
}

export type { AudioDirectorPlan };
