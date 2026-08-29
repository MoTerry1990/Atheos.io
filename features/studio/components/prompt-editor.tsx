"use client";

import { Sparkles, Undo2, WandSparkles } from "lucide-react";
import { useState } from "react";

import { enhancePrompt } from "@/features/studio/lib/api";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  PromptField,
  type PromptModality,
} from "@/features/studio/components/prompt-field";
import { Control } from "@/features/studio/components/model-picker";
import { ShotPlanPreview } from "@/features/studio/components/shot-plan";
import { SEQUENCE_MODEL_FACTS } from "@/services/ai/sequence-models.public";
import { PROMPT_TEMPLATES } from "@/features/studio/data/presets";
import { assemblePrompt, useStudioStore } from "@/store/studio-store";
import { useSelectedModel } from "@/features/studio/lib/use-model";
import { cn } from "@/lib/utils";

/**
 * Prompt editor, template picker and negative prompt.
 *
 * ## The assembled prompt is visible
 *
 * Presets and camera settings append text to what the user typed. That text is
 * shown, on demand, exactly as it will be submitted.
 *
 * This is the single most important honesty decision in the studio. Tools that
 * inject styling text silently produce a specific and maddening failure: the
 * same prompt behaves differently here than anywhere else, and the user cannot
 * see why or remove the part they dislike. Showing the assembly is also how
 * someone learns to write prompts, which is most of what a tool like this is
 * for.
 *
 * ## The negative prompt disappears
 *
 * Not disabled — **absent** — when the selected model does not support one.
 * A greyed-out field invites people to wonder what they did wrong. Its value is
 * cleared in the store at the same time, so a hidden field cannot smuggle text
 * into a request.
 */
export function PromptEditor({ onGenerate }: { onGenerate?: () => void } = {}) {
  const prompt = useStudioStore((state) => state.params.prompt);
  const negativePrompt = useStudioStore((state) => state.params.negativePrompt);
  const params = useStudioStore((state) => state.params);
  const setParam = useStudioStore((state) => state.setParam);
  const applyTemplate = useStudioStore((state) => state.applyTemplate);
  const installed = useStudioStore((state) => state.installed);

  const model = useSelectedModel();

  /**
   * Which placeholder and which enhancer the field should use.
   *
   * Read from the model rather than held in the store: the modality *is* a
   * property of the selected model, and a second copy could disagree with it
   * after a model change — showing video guidance above an image model.
   */
  const modality: PromptModality =
    model.modality === "VIDEO"
      ? "VIDEO"
      : model.modality === "AUDIO"
        ? "AUDIO"
        : "IMAGE";

  /**
   * The selected model's real capabilities, for the plan and its price.
   *
   * Read from `sequence-models.ts`, which was populated by fetching each
   * model's own OpenAPI schema — not from the catalogue's `capabilities`, which
   * described Motion 1 as accepting images and negative prompts for three
   * sprints while its schema accepted neither. A quote built on a wrong
   * capability is a wrong price.
   */
  const facts = SEQUENCE_MODEL_FACTS[model.id];

  const assembled = assemblePrompt(params, installed.styles);
  /**
   * Whether anything was added to what the user typed.
   *
   * No longer decides whether the final prompt is *shown* — it always is, as
   * soon as there is one. It only decides the explanatory line underneath,
   * which has nothing to explain when nothing was appended.
   */
  const hasAdditions = assembled !== prompt.trim() && assembled.length > 0;

  const [enhancing, setEnhancing] = useState(false);
  /** The pre-enhancement text, or null when there is nothing to undo. */
  const [previous, setPrevious] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  /**
   * Replace the prompt with a fuller version of itself.
   *
   * The endpoint never rejects — it returns the original with `changed: false`
   * when the model is down or throttled — so the only failure handled here is
   * the network itself, and it says so plainly rather than silently doing
   * nothing. A button that appears to work and does not is worse than an error.
   */
  async function enhance() {
    const original = prompt.trim();
    setEnhancing(true);
    setNotice("");

    try {
      const result = await enhancePrompt(
        original,
        model.capabilities.durations ? "video" : "image",
      );

      if (!result.changed) {
        setNotice(
          "Could not enhance that just now — your prompt is unchanged.",
        );
        return;
      }

      setPrevious(original);
      setParam("prompt", result.prompt);
      setNotice("Prompt enhanced. Edit it freely, or undo.");
    } catch {
      setNotice("Could not reach the enhancer — your prompt is unchanged.");
    } finally {
      setEnhancing(false);
    }
  }

  function undoEnhance() {
    if (previous === null) return;
    setParam("prompt", previous);
    setPrevious(null);
    setNotice("");
  }

  /**
   * Typing invalidates the undo.
   *
   * After a manual edit, "undo" would throw away the user's own words rather
   * than the enhancement — which is the opposite of what the button promises.
   */
  function handlePromptChange(value: string) {
    setParam("prompt", value);
    if (previous !== null) setPrevious(null);
    if (notice) setNotice("");
  }

  // Built-ins first, then anything downloaded. Grouped by category, which for
  // an installed pack *is* the pack name — so a prompt someone downloaded is
  // always traceable to the thing they can uninstall.
  const byCategory = [...PROMPT_TEMPLATES, ...installed.templates].reduce<
    Record<string, typeof PROMPT_TEMPLATES>
  >((groups, template) => {
    (groups[template.category] ??= []).push(template);
    return groups;
  }, {});

  /**
   * Enhance and undo, rendered inside the field's own footer.
   *
   * They belong with the text they act on rather than in a separate row: a
   * button that rewrites the paragraph above it reads as part of the editor,
   * and putting it there also keeps the row below the field free for the
   * things that are not about the prompt.
   */
  const enhanceControls = (
    <>
      {/* Free, and rate-limited rather than priced — see
          services/ai/enhance.ts. Disabled below three characters because there
          is nothing to expand, which is also the state it is in when the field
          is empty. */}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={enhance}
        disabled={enhancing || prompt.trim().length < 3}
      >
        <Sparkles className={enhancing ? "animate-pulse" : undefined} />
        {enhancing ? "Enhancing…" : "Enhance"}
      </Button>

      {/* The one affordance this feature cannot ship without. Enhancing
          overwrites text the user wrote; without a way back, a click they did
          not mean costs them their prompt. */}
      {previous !== null ? (
        <Button type="button" variant="ghost" size="xs" onClick={undoEnhance}>
          <Undo2 />
          Undo
        </Button>
      ) : null}
    </>
  );

  return (
    <div className="space-y-4">
      <Control label="Prompt">
        <div className="space-y-2">
          {/* The editor surface. `data-studio-prompt` still marks the textarea
              inside it, so the `/` shortcut keeps working unchanged. */}
          <PromptField
            value={prompt}
            onChange={handlePromptChange}
            modality={modality}
            onSubmit={onGenerate}
            footer={enhanceControls}
          />

          {/* Video only. An image has no shot list, and a panel explaining
              that would be noise on the modality most people use. */}
          {modality === "VIDEO" && facts ? (
            <ShotPlanPreview
              prompt={prompt}
              durationSeconds={params.durationSeconds}
              facts={facts}
              baseCredits={model.creditCost}
              mode={params.sequenceMode}
              onModeChange={(next) => setParam("sequenceMode", next)}
              hasReferenceImage={params.references.some(
                (reference) => reference.status === "ready",
              )}
            />
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <WandSparkles />
                  Templates
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-[min(22rem,90vw)]"
              >
                {Object.entries(byCategory).map(([category, templates]) => (
                  <div key={category}>
                    <DropdownMenuLabel className="text-2xs tracking-wider uppercase">
                      {category}
                    </DropdownMenuLabel>
                    {templates.map((template) => (
                      <DropdownMenuItem
                        key={template.id}
                        onClick={() => applyTemplate(template)}
                        className="flex-col items-start gap-0.5 py-2"
                      >
                        <span className="text-sm font-medium">
                          {template.name}
                        </span>
                        <span className="line-clamp-2 text-xs text-wrap text-muted-foreground">
                          {template.prompt}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Always present so `aria-live` has a node to watch — a region that
              appears at the same moment its text does is not reliably
              announced. Enhancing changes the textarea's value without moving
              focus, which a screen reader would otherwise not report at all. */}
          <p
            aria-live="polite"
            className={cn(
              "text-xs text-muted-foreground",
              notice ? "" : "sr-only",
            )}
          >
            {notice}
          </p>

          {/*
            Always shown, never behind a toggle.

            This used to appear only once a preset or camera option had been
            picked, so the common case — type a prompt, press Generate — never
            revealed what was actually submitted. Nothing should be sent on a
            user's behalf that they cannot read first, and that is exactly the
            case where they could not.
          */}
          <div className="space-y-1.5 rounded-lg border border-border bg-surface-sunken p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3" aria-hidden />
              Submitted as
            </p>
            <p
              className={cn(
                "font-mono text-xs leading-relaxed break-words",
                assembled ? "" : "text-muted-foreground italic",
              )}
            >
              {/*
                  The panel holds its place while the prompt is empty.

                  Rendering it only once there is text means it appears at the
                  moment the user starts typing, which is both a layout shift
                  and a worse promise: "we will show you what gets sent" should
                  be true before they have typed anything, not conditional on
                  it.
                */}
              {assembled || "Nothing yet — your prompt will appear here."}
            </p>
            {hasAdditions ? (
              <p className="text-xs text-muted-foreground">
                Style presets and camera settings are appended to your prompt.
                Remove them above to change this.
              </p>
            ) : null}
          </div>
        </div>
      </Control>

      {/* Absent, not disabled, when unsupported. The store clears the value at
          the same time so nothing hidden is ever submitted. */}
      {model.capabilities.supportsNegativePrompt ? (
        <Control label="Negative prompt" hint="What to avoid">
          <Textarea
            value={negativePrompt}
            onChange={(event) => setParam("negativePrompt", event.target.value)}
            placeholder="text, watermark, distorted anatomy, oversaturated"
            rows={2}
            className="resize-y"
          />
        </Control>
      ) : (
        <p className="text-xs text-muted-foreground">
          {model.displayName} does not support a negative prompt.
        </p>
      )}
    </div>
  );
}
