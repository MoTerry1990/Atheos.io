"use client";

import { AlertTriangle, Check, ChevronDown, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CreativePlanResponse } from "@/features/studio/lib/creative-plan";
import type { ImageBrief } from "@/services/ai/image-brief";
import { cn } from "@/lib/utils";
import type { Provenance, Sourced } from "@/services/ai/creative-brief";

/**
 * "Here's what I understood" — the panel between a prompt and a provider.
 *
 * ## Why this exists
 *
 * The composer used to show a shot plan and submit something else. The plan was
 * rendered, read, and thrown away at `studio-workspace.tsx:283`, which sent the
 * browser-assembled prompt instead. A user could read four shots on screen and
 * receive one continuous silent take.
 *
 * This panel shows the brief the **server** built, from the endpoint that will
 * also compile it. The final-prompt preview is the server's own compiler output,
 * not a second reconstruction — so what is displayed and what is sent cannot
 * drift apart.
 *
 * ## Provenance is the point
 *
 * Every value is labelled with where it came from. A user who never said "four
 * shots" must be able to see that Atheos assumed it, and change it, before any
 * money moves.
 */

/**
 * The response type is the wire type, imported rather than redeclared.
 *
 * A second definition here would let the panel drift from what the endpoint
 * sends and still typecheck — which is the same class of mistake as the
 * composer that displayed one plan and submitted another.
 */

/** The label a value's origin earns. Never collapsed into "your settings". */
const PROVENANCE: Record<Provenance, { label: string; tone: string }> = {
  explicit: { label: "Requested", tone: "text-foreground" },
  confirmed: { label: "Confirmed", tone: "text-success" },
  edited: { label: "Changed by you", tone: "text-success" },
  inferred: { label: "Inferred", tone: "text-warning" },
  default: { label: "Recommended", tone: "text-muted-foreground" },
};

/** A brief is an image brief when it says so. Never structural guessing. */
function isImageBrief(
  brief: CreativePlanResponse["brief"],
): brief is ImageBrief {
  return (brief as ImageBrief).kind === "image";
}

function Row({ label, entry }: { label: string; entry: Sourced<unknown> }) {
  const mark = PROVENANCE[entry.from];
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex items-baseline gap-2 text-sm text-foreground">
        <span>
          {Array.isArray(entry.value)
            ? entry.value.join(", ")
            : String(entry.value)}
        </span>
        <span className={cn("text-2xs", mark.tone)}>{mark.label}</span>
      </dd>
      {/* The reason sits under the value rather than in a tooltip: an
          assumption nobody can see is an assumption nobody can correct. */}
      {entry.because && entry.from !== "explicit" ? (
        <p className="w-full text-2xs text-muted-foreground/80">
          {entry.because}
        </p>
      ) : null}
    </div>
  );
}

export function CreativePlanPanel({
  plan,
  onAnswer,
  onConfirm,
  onChooseModel,
  onCancel,
  submitting,
  className,
}: {
  plan: CreativePlanResponse;
  onAnswer: (field: string, value: unknown) => void;
  onConfirm: () => void;
  onChooseModel: (modelId: string) => void;
  onCancel: () => void;
  submitting?: boolean;
  className?: string;
}) {
  const [showPrompt, setShowPrompt] = useState(false);

  const blocked = plan.conflicts.length > 0;
  const questionsOutstanding = plan.clarifications.length > 0;
  // The server withholds the token until nothing is unresolved; the button
  // reads that rather than deciding for itself.
  const canConfirm =
    Boolean(plan.planToken) && !blocked && !questionsOutstanding;

  return (
    <section
      aria-labelledby="creative-plan-heading"
      className={cn(
        "space-y-4 rounded-xl border border-border bg-surface-sunken p-4",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="text-brand size-4" aria-hidden />
        <h2 id="creative-plan-heading" className="text-sm font-medium">
          Here&rsquo;s what I understood
        </h2>
      </div>

      {/* Questions first. Answering them changes everything below, so asking
          after the summary would be asking about something already read. */}
      {questionsOutstanding ? (
        <div className="space-y-3">
          {plan.clarifications.map((q) => (
            <fieldset key={q.field} className="space-y-1.5">
              <legend className="text-xs font-medium text-foreground">
                {q.question}
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((option) => (
                  <Button
                    key={option.label}
                    type="button"
                    size="xs"
                    variant={option.recommended ? "default" : "outline"}
                    onClick={() => onAnswer(q.field, option.value)}
                  >
                    {option.label}
                    {option.recommended ? " · recommended" : ""}
                  </Button>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      ) : null}

      {/* Two briefs, two sets of rows.

          Not one merged list with blanks: a still has no shot count and a clip
          has no spatial relationship, and rendering "Shots —" for a picture is
          the kind of empty field that teaches people to stop reading the panel.

          The image rows lead with subject and placement because that is what
          the benchmark got wrong — the dragon was rendered beside the castle
          rather than on it, and "on a castle" was in the prompt the whole
          time. If Atheos read it, the user should see that it did. */}
      {isImageBrief(plan.brief) ? (
        <dl className="divide-y divide-border/50">
          <Row label="Subject" entry={plan.brief.primarySubject} />
          {plan.brief.subjectAttributes.value.length > 0 ? (
            <Row label="Details" entry={plan.brief.subjectAttributes} />
          ) : null}
          {plan.brief.action.value ? (
            <Row label="Action" entry={plan.brief.action} />
          ) : null}
          {plan.brief.spatialRelationships.value.length > 0 ? (
            <Row label="Placement" entry={plan.brief.spatialRelationships} />
          ) : null}
          <Row label="Setting" entry={plan.brief.setting} />
          <Row label="Framing" entry={plan.brief.cameraFraming} />
          <Row label="Light" entry={plan.brief.lighting} />
          <Row label="Look" entry={plan.brief.realism} />
          <Row label="Shape" entry={plan.brief.aspectRatio} />
          <Row label="Size" entry={plan.brief.resolution} />
        </dl>
      ) : (
        <dl className="divide-y divide-border/50">
          <Row label="Goal" entry={plan.brief.objective} />
          <Row label="Shots" entry={plan.brief.shotCount} />
          <Row label="Editing" entry={plan.brief.cutStyle} />
          <Row label="Sound" entry={plan.brief.audioStrategy} />
          <Row label="Length" entry={plan.brief.durationSeconds} />
          <Row label="Shape" entry={plan.brief.aspectRatio} />
          <Row label="Resolution" entry={plan.brief.resolution} />
        </dl>
      )}

      {/* Conflicts block. Not a warning beside a working button — the button
          below is disabled while any of these stand. */}
      {blocked ? (
        <div
          role="alert"
          className="space-y-1.5 rounded-lg border border-destructive/40 bg-destructive/5 p-3"
        >
          <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
            <AlertTriangle className="size-3.5" aria-hidden />
            This model cannot create this plan
          </p>
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {plan.conflicts.map((conflict) => (
              <li key={conflict}>— {conflict}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.caveats.length > 0 ? (
        <ul className="space-y-0.5 text-2xs text-muted-foreground">
          {plan.caveats.map((caveat) => (
            <li key={caveat}>— {caveat}</li>
          ))}
        </ul>
      ) : null}

      {/* Alternatives, with their real compromises and the server's prices. */}
      {blocked || plan.alternatives.length > 1 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Models that can make this</p>
          {plan.alternatives
            .filter((alt) => alt.compatibility !== "incompatible")
            .map((alt) => (
              <button
                key={alt.modelId}
                type="button"
                onClick={() => onChooseModel(alt.modelId)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/60 p-2 text-left text-xs hover:border-border focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                <span>
                  <span className="text-foreground">{alt.label}</span>
                  {alt.modelId === plan.recommendedModelId ? (
                    <Badge size="sm" variant="success" className="ml-2">
                      Recommended
                    </Badge>
                  ) : null}
                  {alt.caveats.length > 0 ? (
                    <span className="block text-muted-foreground">
                      {alt.caveats[0]}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {alt.credits.toLocaleString("en-US")} credits ·{" "}
                  {Math.round(alt.estimatedSeconds / 60)} min
                </span>
              </button>
            ))}
        </div>
      ) : null}

      {/* The server's own compiler output. Not a second reconstruction. */}
      {plan.finalPromptPreview ? (
        <div>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => setShowPrompt((open) => !open)}
            aria-expanded={showPrompt}
          >
            <ChevronDown
              className={cn("transition-transform", showPrompt && "rotate-180")}
            />
            {showPrompt ? "Hide" : "Show"} final prompt
          </Button>

          {showPrompt ? (
            <div className="mt-2 space-y-2 rounded-lg border border-border/60 p-3">
              <p className="text-2xs text-muted-foreground">
                Compiled by Atheos for {plan.finalPromptPreview.modelId} —
                compiler v{plan.finalPromptPreview.compilerVersion}. This is
                what the provider receives.
              </p>
              <pre className="text-2xs [overflow-wrap:anywhere] whitespace-pre-wrap text-foreground">
                {plan.finalPromptPreview.prompt}
              </pre>
              {plan.finalPromptPreview.omitted.length > 0 ? (
                <ul className="space-y-0.5 text-2xs text-warning">
                  {plan.finalPromptPreview.omitted.map((item) => (
                    <li key={item}>Dropped: {item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3">
        <span className="text-xs text-muted-foreground">
          {plan.quote
            ? `${plan.quote.credits.toLocaleString("en-US")} credits · about ${Math.round(plan.quote.estimatedSeconds / 60)} min`
            : "No price until a model can make this"}
        </span>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="gradient"
            onClick={onConfirm}
            disabled={!canConfirm || submitting}
            loading={submitting}
            title={
              blocked
                ? "Choose a model that can make this plan"
                : questionsOutstanding
                  ? "Answer the questions above first"
                  : undefined
            }
          >
            <Check />
            Confirm and create
          </Button>
        </div>
      </div>
    </section>
  );
}
