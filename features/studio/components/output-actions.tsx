"use client";

import { Copy, Scissors, Sparkles, ZoomIn } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiError, submitGeneration } from "@/features/studio/lib/api";
import { useModels } from "@/features/studio/lib/use-model";
import type { StudioJob } from "@/features/studio/types";
import { useStudioStore } from "@/store/studio-store";
import { toast } from "@/lib/toast";

/**
 * Derived operations, offered from a finished result.
 *
 * Upscale, background removal and variations all take an **existing image** as
 * input, so the only sensible place to start them is next to one. Putting them
 * in the composer would mean asking the user to paste a URL for something they
 * are already looking at.
 *
 * Each submission records `parentId`, so lineage survives: the schema has a
 * self-relation for exactly this, and it is what will let the library show
 * "3 variations of this" rather than five unrelated images.
 *
 * ## Availability is capability-driven
 *
 * A button appears only if some configured model declares that operation. With
 * only OpenAI configured there is no upscaler, and the button is absent rather
 * than present and failing — the same rule the composer follows for negative
 * prompts and seeds.
 */

const ACTIONS = [
  {
    operation: "upscale" as const,
    label: "Upscale",
    icon: ZoomIn,
    hint: "Increase resolution",
  },
  {
    operation: "remove-background" as const,
    label: "Remove background",
    icon: Scissors,
    hint: "Cut out the subject",
  },
  {
    operation: "variations" as const,
    label: "Variations",
    icon: Copy,
    hint: "More like this",
  },
];

export function OutputActions({
  job,
  outputUrl,
}: {
  job: StudioJob;
  outputUrl: string | null;
}) {
  const models = useModels();
  const enqueue = useStudioStore((state) => state.enqueue);
  const [pending, setPending] = useState<string | null>(null);

  // Nothing to derive from until the asset has a reachable URL.
  if (!outputUrl || job.status !== "succeeded") return null;

  const available = ACTIONS.filter((action) =>
    models.some((model) =>
      model.capabilities.operations.includes(action.operation),
    ),
  );

  if (available.length === 0) return null;

  async function run(operation: (typeof ACTIONS)[number]["operation"]) {
    const model = models.find((entry) =>
      entry.capabilities.operations.includes(operation),
    );
    if (!model) return;

    setPending(operation);

    try {
      const { generationId } = await submitGeneration({
        operation,
        modelId: model.id,
        // Upscale and background removal ignore the prompt; variations reuse
        // the original so the result stays recognisably related.
        prompt: operation === "variations" ? job.params.prompt : "",
        inputImageUrls: [outputUrl!],
        outputs: operation === "variations" ? 2 : 1,
        scale: operation === "upscale" ? 2 : undefined,
        parentId: job.id,
      });

      enqueue({
        id: generationId,
        status: "queued",
        params: { ...job.params, prompt: job.params.prompt },
        modelName: model.displayName,
        creditCost: model.creditCost,
        progress: 0,
        outputs: [],
        error: null,
        createdAt: Date.now(),
        completedAt: null,
      });

      toast.success(
        operation === "upscale"
          ? "Upscaling"
          : operation === "remove-background"
            ? "Removing background"
            : "Generating variations",
        `${model.creditCost} credits`,
      );
    } catch (cause) {
      toast.error("Could not start that", {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 flex items-center gap-1 text-2xs text-muted-foreground">
        <Sparkles className="size-3" aria-hidden />
        Do more
      </span>

      {available.map((action) => (
        <Button
          key={action.operation}
          variant="outline"
          size="xs"
          title={action.hint}
          loading={pending === action.operation}
          disabled={pending !== null}
          onClick={() => run(action.operation)}
        >
          <action.icon />
          {action.label}
        </Button>
      ))}
    </div>
  );
}
