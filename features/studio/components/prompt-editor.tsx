"use client";

import { Eye, EyeOff, Sparkles, Undo2, WandSparkles } from "lucide-react";
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
import { Control } from "@/features/studio/components/model-picker";
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
export function PromptEditor() {
  const prompt = useStudioStore((state) => state.params.prompt);
  const negativePrompt = useStudioStore((state) => state.params.negativePrompt);
  const params = useStudioStore((state) => state.params);
  const setParam = useStudioStore((state) => state.setParam);
  const applyTemplate = useStudioStore((state) => state.applyTemplate);
  const installed = useStudioStore((state) => state.installed);

  const [showAssembled, setShowAssembled] = useState(false);

  const model = useSelectedModel();
  const assembled = assemblePrompt(params, installed.styles);
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

  return (
    <div className="space-y-4">
      <Control label="Prompt" hint={`${prompt.length} characters`}>
        <div className="space-y-2">
          <Textarea
            value={prompt}
            onChange={(event) => handlePromptChange(event.target.value)}
            placeholder="Describe what you want to see — subject, setting, light, mood."
            rows={5}
            className="resize-y"
            /* The `/` shortcut's target. A data attribute rather than an id
               because the studio preview route renders this component twice on
               one page, and duplicate ids would make the shortcut focus
               whichever the browser found first. */
            data-studio-prompt
          />

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

            {/* Free, and rate-limited rather than priced — see
                services/ai/enhance.ts. Disabled below three characters because
                there is nothing to expand, which is also the state it is in
                when the field is empty. */}
            <Button
              variant="outline"
              size="sm"
              onClick={enhance}
              disabled={enhancing || prompt.trim().length < 3}
            >
              <Sparkles className={enhancing ? "animate-pulse" : undefined} />
              {enhancing ? "Enhancing…" : "Enhance"}
            </Button>

            {/* The one affordance this feature cannot ship without. Enhancing
                overwrites text the user wrote; without a way back, a click they
                did not mean costs them their prompt. Cleared as soon as they
                type, because at that point "undo" would discard their edit
                rather than the enhancement. */}
            {previous !== null ? (
              <Button variant="ghost" size="sm" onClick={undoEnhance}>
                <Undo2 />
                Undo
              </Button>
            ) : null}

            {hasAdditions ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAssembled((open) => !open)}
                aria-expanded={showAssembled}
              >
                {showAssembled ? <EyeOff /> : <Eye />}
                {showAssembled ? "Hide" : "Show"} final prompt
              </Button>
            ) : null}
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

          {showAssembled && hasAdditions ? (
            <div className="space-y-1.5 rounded-lg border border-border bg-surface-sunken p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Sparkles className="size-3" aria-hidden />
                Submitted as
              </p>
              <p className="font-mono text-xs leading-relaxed break-words">
                {assembled}
              </p>
              <p className="text-xs text-muted-foreground">
                Style presets and camera settings are appended to your prompt.
                Remove them above to change this.
              </p>
            </div>
          ) : null}
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
