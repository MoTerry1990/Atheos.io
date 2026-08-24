"use client";

import { useCallback, useRef, useState } from "react";

import { findModelIn } from "@/features/studio/data/models";
import { ApiError } from "@/features/studio/lib/api";
import {
  planCreation,
  resolveAnimateSource,
  type AnimateSource,
  type CreativePlanResponse,
} from "@/features/studio/lib/creative-plan";
import { toast } from "@/lib/toast";
import type { CreativeBrief } from "@/services/ai/creative-brief";
import type { ImageBrief } from "@/services/ai/image-brief";
import { useStudioStore } from "@/store/studio-store";

/**
 * Extracted from `studio-workspace.tsx` so it can be tested directly.
 *
 * The hook *is* the wiring this sprint exists to add — button to plan, plan to
 * confirmation, confirmation to a submission carrying a signed token. Leaving
 * it inside a 900-line component would have meant the only way to test it was
 * to mount the whole studio, which is the reason the old submission path went
 * four sprints without anyone noticing it discarded the plan.
 */

/**
 * Planning, and the decision that follows it.
 *
 * ## Why the studio asks the server what it understood
 *
 * The composer can describe a four-shot commercial perfectly well on its own —
 * it used to, in `shot-plan.tsx` — and none of that description reached a
 * provider. So the plan the user confirms is the *server's*, from the endpoint
 * that will also compile it, and confirmation returns a signed token rather
 * than a prompt. There is no longer a version of the plan that only the browser
 * knows about.
 *
 * ## Disabled is a first-class state, not an error
 *
 * `/api/creative/plan` answers 404 while `ENABLE_CREATIVE_DIRECTOR` is off, and
 * `planCreation` turns that into `null`. This hook then submits directly, which
 * is exactly the behaviour that shipped before — so the feature can land
 * disabled and change nothing until it is switched on.
 */
export function useCreativeDirector(
  generate: (director?: {
    planToken: string;
    confirmedBrief: CreativeBrief | ImageBrief;
    clientIdempotencyKey: string;
    /** Owned asset id for "animate this". Never a URL. */
    sourceAssetId?: string;
  }) => Promise<string | null>,
) {
  const params = useStudioStore((state) => state.params);
  const models = useStudioStore((state) => state.models);
  const setModel = useStudioStore((state) => state.setModel);

  const [plan, setPlan] = useState<CreativePlanResponse | null>(null);
  const [planning, setPlanning] = useState(false);

  /**
   * Answers and the chosen model persist across re-plans.
   *
   * A question answered once must not be asked again because the model changed
   * — re-planning sends the accumulated answers back, and the server marks
   * those fields `confirmed` rather than re-inferring them.
   */
  const answers = useRef<Record<string, unknown>>({});
  const chosenModelId = useRef<string | null>(null);

  /** One key per confirmed plan, so a double-click is not a second video. */
  const idempotencyKey = useRef<string | null>(null);

  /**
   * The picture being animated, when there is one.
   *
   * An id, held across the plan/confirm round trip and handed to the submission
   * so the server can re-resolve it. Never a URL, and never the picture itself.
   */
  const sourceAssetId = useRef<string | null>(null);
  const [sourceChoice, setSourceChoice] = useState<AnimateSource | null>(null);

  const requestPlan = useCallback(
    async (modelId?: string) => {
      const model = findModelIn(models, modelId ?? params.modelId);
      const modality = model.modality === "VIDEO" ? "video" : "image";
      setPlanning(true);
      try {
        return await planCreation({
          prompt: params.prompt,
          modality,
          modelId: modelId ?? chosenModelId.current ?? params.modelId,
          aspectRatio: params.aspectRatio,
          /**
           * Duration is a video field and size is an image one.
           *
           * Sending both would put a `durationSeconds` in an image brief and a
           * pixel class in a clip's — values nobody chose, inside the hash the
           * plan token signs. A field the user is held to has to be a field the
           * request actually had.
           */
          ...(modality === "video"
            ? { durationSeconds: Math.round(params.durationSeconds) }
            : {}),
          // Opaque local ids. Never URLs — the endpoint has no business
          // holding a fetchable link to a user's reference.
          /**
           * Opaque ids only. Never URLs — the endpoint has no business holding
           * a fetchable link to a user's reference.
           *
           * An "animate this" source counts as a reference for planning: it is
           * what makes the brief need a model with an image input, and what
           * makes Motion 1 come back incompatible instead of quietly producing
           * an unrelated clip.
           */
          referenceIds: [
            ...(sourceAssetId.current ? [sourceAssetId.current] : []),
            ...params.references
              .filter((reference) => reference.status === "ready")
              .map((reference) => reference.id),
          ],
          answers: answers.current,
        });
      } finally {
        setPlanning(false);
      }
    },
    [
      models,
      params.prompt,
      params.modelId,
      params.durationSeconds,
      params.aspectRatio,
      params.references,
    ],
  );

  /**
   * The Generate button's entry point.
   *
   * Both modalities plan now. It used to be video only, on the reasoning that a
   * still has no shots or sound to confirm — which was wrong for the reason the
   * dragon benchmark showed: the thing worth confirming about an image is its
   * *shape and size*, and a 1024x1024 square was produced from a prompt whose
   * cinematic wide framing was never surfaced to anyone.
   *
   * Audio has no equivalent for a still, so the image panel simply has fewer
   * rows. That is not a reason to skip the panel.
   */
  const start = useCallback(async () => {
    const model = findModelIn(models, params.modelId);
    if (model.modality !== "VIDEO" && model.modality !== "IMAGE") {
      // Audio and anything else keeps the existing direct path.
      void generate();
      return;
    }

    try {
      const result = await requestPlan();
      if (!result) {
        // Director disabled. The path that shipped before.
        void generate();
        return;
      }
      idempotencyKey.current = crypto.randomUUID();
      setPlan(result);
    } catch (cause) {
      /**
       * A failed plan does not fall through to a direct submission.
       *
       * Falling through would send the browser-assembled prompt — the precise
       * bypass this feature exists to close — and it would do it at the moment
       * the user is least likely to notice, because they asked for a video and
       * got one.
       */
      toast.error("Could not plan that", {
        description:
          cause instanceof ApiError
            ? cause.message
            : "Planning failed. Nothing was generated and no credits were spent.",
      });
    }
  }, [models, params.modelId, generate, requestPlan]);

  const answer = useCallback(
    async (field: string, value: unknown) => {
      answers.current = { ...answers.current, [field]: value };
      try {
        const result = await requestPlan();
        if (result) setPlan(result);
      } catch {
        toast.error("Could not update that plan");
      }
    },
    [requestPlan],
  );

  const chooseModel = useCallback(
    async (modelId: string) => {
      chosenModelId.current = modelId;
      // The rest of the studio has to agree with the panel. Leaving the store
      // pointing at the old model would show one price in the composer and
      // another in the panel — the disagreement this sprint set out to end.
      if (models.some((model) => model.id === modelId)) setModel(modelId);
      try {
        const result = await requestPlan(modelId);
        if (result) setPlan(result);
      } catch {
        toast.error("Could not price that model");
      }
    },
    [models, setModel, requestPlan],
  );

  const confirm = useCallback(async () => {
    if (!plan?.planToken) return;
    const generationId = await generate({
      planToken: plan.planToken,
      confirmedBrief: plan.brief,
      clientIdempotencyKey: idempotencyKey.current ?? plan.planToken.slice(-32),
      ...(sourceAssetId.current
        ? { sourceAssetId: sourceAssetId.current }
        : {}),
    });
    // Only on a submission that happened. Closing on failure would leave the
    // user with no plan, no video and nothing to retry.
    if (generationId) {
      setPlan(null);
      answers.current = {};
      chosenModelId.current = null;
      sourceAssetId.current = null;
      setSourceChoice(null);
    }
  }, [plan, generate]);

  const cancel = useCallback(() => {
    setPlan(null);
    setSourceChoice(null);
    sourceAssetId.current = null;
  }, []);

  /**
   * "Now make this image a video."
   *
   * ## What this replaces
   *
   * The audited follow-up generation ran `TEXT_TO_VIDEO` on Motion 1 with
   * `inputImageUrls: []` and `parentId: null` — a fresh clip from a stale
   * prompt, sharing nothing with the picture on screen. Motion 1 has no image
   * input at all, so it could not have been otherwise.
   *
   * Here the id is resolved server-side first, then planned. If the selected
   * model cannot take an image the plan comes back `incompatible` and the panel
   * refuses rather than generating something unrelated.
   */
  const animateFrom = useCallback(
    async (assetId?: string) => {
      let resolved: AnimateSource | null;
      try {
        resolved = await resolveAnimateSource(assetId ? { assetId } : {});
      } catch (cause) {
        toast.error("Could not find that image", {
          description:
            cause instanceof ApiError ? cause.message : "Please try again.",
        });
        return;
      }

      // Director disabled — the action is not offered, and doing nothing is
      // better than starting an unreferenced clip.
      if (!resolved) return;

      if (resolved.status === "none") {
        setSourceChoice(resolved);
        toast.warning("Nothing to animate yet", resolved.reason);
        return;
      }

      if (resolved.status === "choose") {
        // Ask. Silently taking the newest is right most of the time, and the
        // times it is wrong are a paid video of the wrong picture.
        setSourceChoice(resolved);
        return;
      }

      sourceAssetId.current = resolved.assetId;
      setSourceChoice(null);
      await start();
    },
    [start],
  );

  return {
    plan,
    planning,
    start,
    answer,
    chooseModel,
    confirm,
    cancel,
    animateFrom,
    sourceChoice,
    clearSourceChoice: () => setSourceChoice(null),
  };
}
