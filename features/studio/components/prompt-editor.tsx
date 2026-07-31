"use client";

import { Eye, EyeOff, Sparkles, WandSparkles } from "lucide-react";
import { useState } from "react";

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
import { findModel } from "@/features/studio/data/models";
import { assemblePrompt, useStudioStore } from "@/store/studio-store";

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

  const [showAssembled, setShowAssembled] = useState(false);

  const model = findModel(params.modelId);
  const assembled = assemblePrompt(params);
  const hasAdditions = assembled !== prompt.trim() && assembled.length > 0;

  const byCategory = PROMPT_TEMPLATES.reduce<
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
            onChange={(event) => setParam("prompt", event.target.value)}
            placeholder="Describe what you want to see — subject, setting, light, mood."
            rows={5}
            className="resize-y"
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
