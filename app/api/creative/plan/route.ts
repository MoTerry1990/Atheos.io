import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guard, withHeaders } from "@/lib/api-guard";
import { isAdmin } from "@/services/admin/auth";
import type { Caller } from "@/services/ai/model-policy";
import { quoteSequenceForCaller } from "@/services/connectors/sequence-quote";
import {
  isRunnableFor,
  MODEL_UNAVAILABLE_CODE,
  MODEL_UNAVAILABLE_MESSAGE,
} from "@/services/ai/model-policy";
import {
  MODEL_CAPABILITIES,
  recommendModels,
  type RoutingVerdict,
} from "@/services/ai/brief-routing";
import { compileForModel } from "@/services/ai/compile-for-model";
import { confirmField, assumptionsIn } from "@/services/ai/creative-brief";
import { compileImageForModel } from "@/services/ai/compile-image";
import {
  confirmImageField,
  imageAssumptionsIn,
} from "@/services/ai/image-brief";
import {
  findImageModel,
  type ImageAspectRatio,
  type ImageResolution,
} from "@/services/ai/image-capabilities";
import {
  imageClarificationsFor,
  planImageFromPrompt,
} from "@/services/ai/image-planner";
import { recommendImageModels } from "@/services/ai/image-routing";
import {
  clarificationsFor,
  planFromPrompt,
} from "@/services/ai/intent-planner";
import {
  creativeDirectorReady,
  issuePlanToken,
  PLAN_TTL_SECONDS,
} from "@/services/ai/plan-token";

/**
 * Creative planning.
 *
 *   POST  turn a prompt into a brief, a quote and — if confirmable — a token
 *
 * ## This endpoint never spends anything
 *
 * No provider call, no credit reservation, no generation. It reads a prompt and
 * returns what Atheos understood, which is why it can be called freely while
 * somebody edits their plan.
 *
 * ## Why a token comes back rather than a compiled prompt
 *
 * The old path had the browser build the provider prompt and send it
 * (`studio-workspace.tsx:283`). Anything the browser can build, anyone can
 * build. So the client receives a *preview* of the compiled prompt for display
 * and a signed token that carries only hashes; the server recompiles from the
 * brief at submission. The preview is for the user's eyes and has no authority.
 *
 * ## A token is only issued when there is nothing left to ask
 *
 * While clarifications are outstanding or conflicts unresolved, the response
 * carries questions and alternatives and **no token** — so there is nothing to
 * submit until the user has actually decided.
 */

const planSchema = z.object({
  // Capped like the generations endpoint: an unbounded prompt is a cheap way to
  // make the server do expensive work.
  prompt: z.string().min(1).max(4000),
  modality: z.enum(["video", "image"]).default("video"),
  /**
   * What kind of plan this is.
   *
   * `sequence` reuses this route rather than getting one of its own, so there
   * is a single place that resolves a caller, checks policy, prices work and
   * signs the result. A second endpoint would be a second chance to forget one
   * of those.
   *
   * Deliberately not inferred from the presence of `clips`: a client that
   * mistypes a field should get a plain single-shot plan, not silently switch
   * product.
   */
  kind: z.enum(["single", "sequence"]).default("single"),
  mode: z.enum(["continuous", "directed", "multi_shot"]).optional(),
  outputs: z.number().int().min(1).max(8).optional(),
  modelId: z.string().max(120).optional(),
  durationSeconds: z.number().int().min(1).max(60).optional(),
  /**
   * Two ratio vocabularies, deliberately not merged.
   *
   * Video models offer 16:9 and 9:16 and nothing else; image models offer ten
   * shapes. A single union would let a client ask for a 21:9 clip and get a
   * schema-valid request no model can serve.
   */
  aspectRatio: z
    .enum([
      "16:9",
      "9:16",
      "1:1",
      "4:3",
      "3:4",
      "3:2",
      "2:3",
      "21:9",
      "4:5",
      "5:4",
    ])
    .optional(),
  resolution: z.enum(["720p", "1080p", "1K", "2K", "4K"]).optional(),
  /** Opaque ids only. No URLs, no bytes. */
  referenceIds: z.array(z.string().max(120)).max(3).default([]),
  /** Answers from a previous round, as field → value. */
  answers: z.record(z.string(), z.unknown()).optional(),
});

function sanitiseVerdict(verdict: RoutingVerdict) {
  return {
    modelId: verdict.model.id,
    label: verdict.model.label,
    compatibility: verdict.compatibility,
    conflicts: verdict.conflicts,
    caveats: verdict.caveats,
    credits: verdict.credits,
    estimatedSeconds: verdict.estimatedSeconds,
    maxDurationSeconds: verdict.model.maxDurationSeconds,
    maxResolution: verdict.model.maxResolution,
  };
}

export async function POST(request: NextRequest) {
  /**
   * The flag is checked before anything else, and checked on the server.
   *
   * `creativeDirectorReady()` fails closed: the flag alone is not enough, the
   * signing secret has to be present and well-formed too. A 404 rather than a
   * 403 — a disabled feature should not confirm its own existence.
   */
  if (!creativeDirectorReady().ready) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const gate = await guard(request, {
    // Planning is cheap but not free, and it is a loop a client could sit in.
    policy: "generate",
    body: planSchema,
    context: "POST /api/creative/plan",
  });
  if (gate instanceof NextResponse) return gate;

  /**
   * The caller the guard already resolved.
   *
   * Not `requireUser()`. That helper *redirects* a session-less caller to sign
   * in, which is right for a page and wrong for an API route — it would refuse
   * a valid API key with a redirect rather than serve it. The guard has already
   * resolved a session or a key and returned 401 if neither held, so
   * `gate.user` is non-null here and its provisioning branch was unreachable
   * anyway: the guard 401s on a missing row before this line is reached.
   */
  const user = gate.user!;
  const body = gate.body;

  if (body.kind === "sequence") {
    return withHeaders(
      NextResponse.json(await planSequence(body, user.id)),
      gate,
    );
  }

  if (body.modality === "image") {
    return withHeaders(NextResponse.json(await planImage(body, user.id)), gate);
  }

  // 1. The prompt is preserved exactly; everything else is derived.
  let brief = planFromPrompt({
    prompt: body.prompt,
    referenceImageCount: body.referenceIds.length,
    controls: {
      durationSeconds: body.durationSeconds,
      // The schema accepts ten shapes because images offer ten. A video model
      // offers three, so anything else is dropped here rather than carried into
      // a brief no model could serve.
      aspectRatio: VIDEO_RATIOS.has(body.aspectRatio ?? "")
        ? (body.aspectRatio as "16:9" | "9:16" | "1:1")
        : undefined,
    },
  });

  if (body.resolution) {
    brief = confirmField(
      brief,
      "resolution" as never,
      body.resolution as never,
    );
  }

  // 2. Answers from a previous round become the user's own values.
  for (const [field, value] of Object.entries(body.answers ?? {})) {
    if (!(field in brief)) continue;
    brief = confirmField(brief, field as never, value as never, "confirmed");
  }

  // 3. Capability reconciliation.
  const recommendation = recommendModels(brief);
  const caller = (await isAdmin().catch(() => false)) ? "owner" : "public";
  /**
   * Licence policy, before a price is quoted.
   *
   * `submitGeneration` refuses an unrunnable model, so nothing here can spend.
   * But a quote is a commitment in its own right — it names a credit price and
   * mints a signed plan token — and issuing one for a model we may not run
   * would mean the interface offers a deal the server always breaks. Refusing
   * at the recommendation step keeps the two answers consistent.
   */
  const selected = body.modelId
    ? MODEL_CAPABILITIES.find(
        (m) => m.id === body.modelId && isRunnableFor(m.id, caller),
      )
    : recommendation.recommended?.model;

  if (selected && !isRunnableFor(selected.id, caller)) {
    return NextResponse.json(
      { error: MODEL_UNAVAILABLE_MESSAGE, code: MODEL_UNAVAILABLE_CODE },
      { status: 400 },
    );
  }

  const selectedVerdict = selected
    ? recommendation.verdicts.find((v) => v.model.id === selected.id)
    : undefined;

  const clarifications = clarificationsFor(brief);
  const unresolved =
    !selectedVerdict || selectedVerdict.compatibility === "incompatible";

  // 4. A preview only when something can actually be compiled.
  let preview: {
    modelId: string;
    compilerVersion: number;
    prompt: string;
    negativePrompt: string;
    omitted: string[];
  } | null = null;

  if (selected && !unresolved) {
    const compiled = compileForModel(brief, selected);
    preview = {
      modelId: compiled.modelId,
      compilerVersion: compiled.compilerVersion,
      prompt: compiled.prompt,
      negativePrompt: compiled.negativePrompt,
      omitted: compiled.omitted,
    };
  }

  /**
   * 5. The token, only when there is nothing left to decide.
   *
   * Outstanding questions or an incompatible model mean the user has not
   * finished choosing, and a token issued now would let them submit a plan they
   * were still being asked about.
   */
  const confirmable =
    clarifications.length === 0 && !unresolved && Boolean(selected);

  const issued =
    confirmable && selected
      ? issuePlanToken({
          userId: user.id,
          brief,
          modelId: selected.id,
          quotedCredits: selectedVerdict!.credits,
          referenceIds: body.referenceIds,
          nowMs: Date.now(),
        })
      : null;

  return withHeaders(
    NextResponse.json({
      /**
       * The brief, whole.
       *
       * Not a display subset. The token carries `stableHash(brief)`, and the
       * client sends this object back as `confirmedBrief` at submission — a
       * trimmed copy would hash to something else and be rejected as tampered,
       * which is the correct behaviour for a brief that genuinely differs.
       *
       * Nothing here is sensitive: every field is derived from the user's own
       * prompt, and references are counts and opaque ids rather than URLs.
       */
      brief,
      assumptions: assumptionsIn(brief),
      clarifications,
      conflicts: selectedVerdict?.conflicts ?? [],
      caveats: selectedVerdict?.caveats ?? [],
      alternatives: recommendation.verdicts.map(sanitiseVerdict),
      recommendedModelId: recommendation.recommended?.model.id ?? null,
      blockingRequirements: recommendation.blockingRequirements,
      quote: selectedVerdict
        ? {
            credits: selectedVerdict.credits,
            estimatedSeconds: selectedVerdict.estimatedSeconds,
          }
        : null,
      // For display only. The server recompiles at submission.
      finalPromptPreview: preview,
      confirmationRequired: true,
      // Absent while anything is unresolved.
      planToken: issued?.token ?? null,
      expiresAtMs: issued?.payload.expiresAtMs ?? null,
      ttlSeconds: PLAN_TTL_SECONDS,
    }),
    gate,
  );
}

/**
 * The image half of planning.
 *
 * Deliberately the same *shape* of response as the video half — brief,
 * assumptions, clarifications, conflicts, alternatives, quote, preview, token —
 * because the confirmation panel renders both and a second response shape would
 * be a second panel to keep honest.
 *
 * What differs is only the catalogue and the compiler, which is the real
 * difference between planning a still and planning a clip.
 */
async function planImage(
  body: {
    prompt: string;
    modelId?: string;
    aspectRatio?: string;
    resolution?: string;
    referenceIds: string[];
    answers?: Record<string, unknown>;
  },
  userId: string,
) {
  /**
   * References are counted here and resolved at submission.
   *
   * Planning needs to know *how many* there are — it changes which models are
   * compatible and what they cost. It does not need the bytes, and minting
   * signed URLs for a plan the user may never confirm would hand out fetchable
   * links for nothing.
   */
  const referenceCount = body.referenceIds.length;

  let brief = planImageFromPrompt({
    prompt: body.prompt,
    referenceImageCount: referenceCount,
    controls: {
      aspectRatio: IMAGE_RATIOS.has(body.aspectRatio ?? "")
        ? (body.aspectRatio as ImageAspectRatio)
        : undefined,
      resolution: IMAGE_SIZES.has(body.resolution ?? "")
        ? (body.resolution as ImageResolution)
        : undefined,
    },
  });

  // Answers from a previous round become the user's own values.
  for (const [field, value] of Object.entries(body.answers ?? {})) {
    if (!(field in brief)) continue;
    brief = confirmImageField(
      brief,
      field as never,
      value as never,
      "confirmed",
    );
  }

  const recommendation = recommendImageModels(brief);
  const caller = (await isAdmin().catch(() => false)) ? "owner" : "public";
  // Same gate as the video branch above, for the same reason.
  const selected = body.modelId
    ? (() => {
        const found = findImageModel(body.modelId);
        return found && isRunnableFor(found.id, caller) ? found : undefined;
      })()
    : recommendation.recommended?.model;

  if (selected && !isRunnableFor(selected.id, caller)) {
    return NextResponse.json(
      { error: MODEL_UNAVAILABLE_MESSAGE, code: MODEL_UNAVAILABLE_CODE },
      { status: 400 },
    );
  }

  const selectedVerdict = selected
    ? recommendation.verdicts.find((v) => v.model.id === selected.id)
    : undefined;

  const clarifications = imageClarificationsFor(brief);
  const unresolved =
    !selectedVerdict || selectedVerdict.compatibility === "incompatible";

  let preview: {
    modelId: string;
    compilerVersion: number;
    prompt: string;
    negativePrompt: string;
    omitted: string[];
  } | null = null;

  if (selected && !unresolved) {
    try {
      const compiled = compileImageForModel({
        brief,
        model: selected,
        // The preview shows the prompt, not the pictures. Reference URLs are
        // minted at submission, after ownership is proved.
        referenceUrls: [],
      });
      preview = {
        modelId: compiled.modelId,
        compilerVersion: compiled.compilerVersion,
        prompt: compiled.prompt,
        negativePrompt: compiled.negativePrompt,
        omitted: compiled.omitted,
      };
    } catch {
      // A compiler that refuses is a conflict, not a 500. It shows up in the
      // verdict the panel already renders.
      preview = null;
    }
  }

  const confirmable =
    clarifications.length === 0 &&
    !unresolved &&
    Boolean(selected) &&
    selectedVerdict?.credits != null;

  const issued =
    confirmable && selected
      ? issuePlanToken({
          userId,
          brief,
          modelId: selected.id,
          quotedCredits: selectedVerdict!.credits!,
          referenceIds: body.referenceIds,
          nowMs: Date.now(),
        })
      : null;

  return {
    // Whole, not a display subset — the token carries stableHash(brief) and the
    // client sends this object back at submission.
    brief,
    assumptions: imageAssumptionsIn(brief),
    clarifications,
    conflicts: selectedVerdict?.conflicts ?? [],
    caveats: selectedVerdict?.caveats ?? [],
    alternatives: recommendation.verdicts.map((v) => ({
      modelId: v.model.id,
      label: v.model.label,
      compatibility: v.compatibility,
      conflicts: v.conflicts,
      caveats: v.caveats,
      credits: v.credits ?? 0,
      estimatedSeconds: v.estimatedSeconds,
      maxDurationSeconds: 0,
      maxResolution: v.effectiveResolution,
    })),
    recommendedModelId: recommendation.recommended?.model.id ?? null,
    blockingRequirements: recommendation.blockingRequirements,
    quote:
      selectedVerdict?.credits != null
        ? {
            credits: selectedVerdict.credits,
            estimatedSeconds: selectedVerdict.estimatedSeconds,
          }
        : null,
    finalPromptPreview: preview,
    confirmationRequired: true,
    planToken: issued?.token ?? null,
    expiresAtMs: issued?.payload.expiresAtMs ?? null,
    ttlSeconds: PLAN_TTL_SECONDS,
  };
}

/** The three shapes every audited video model offers. */
const VIDEO_RATIOS = new Set(["16:9", "9:16", "1:1"]);

/** The shapes and sizes the image vocabulary actually has. */
const IMAGE_RATIOS = new Set([
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "21:9",
  "4:5",
  "5:4",
]);
const IMAGE_SIZES = new Set(["1K", "2K", "4K"]);

/**
 * A sequence quote, priced and signed.
 *
 * ## Why it lives here
 *
 * Everything money touches goes through one door. This route already resolves
 * the caller from the session, checks the licence policy, refuses a model the
 * caller may not run and mints the signed token that submission verifies —
 * and a sequence needs all four. Giving it its own endpoint would mean writing
 * them again, and the second copy is the one that forgets something.
 *
 * ## The client sends settings, never a price
 *
 * `SequenceQuoteRequest` has no price field. If a client sends one anyway it
 * is dropped by the schema above and would be ignored regardless:
 * `quoteSequenceForCaller` computes the figure from the settings through
 * `priceFor`, which is the only function that knows what anything costs.
 */
async function planSequence(
  body: z.infer<typeof planSchema>,
  userId: string,
): Promise<Record<string, unknown>> {
  const caller: Caller = (await isAdmin().catch(() => false))
    ? "owner"
    : "public";

  const result = quoteSequenceForCaller(
    {
      publicModelId: body.modelId ?? "",
      mode: body.mode ?? "continuous",
      prompt: body.prompt,
      durationSeconds: body.durationSeconds ?? 5,
      outputs: body.outputs,
      hasReferenceImage: (body.referenceIds?.length ?? 0) > 0,
      requestedResolution: body.resolution,
    },
    caller,
  );

  if (!result.ok || !result.quote) {
    return { ok: false, code: result.reason, message: result.message };
  }

  const { quote } = result;

  /**
   * Signed against the *normalised* request, not the one that arrived.
   *
   * The settings below are what the server decided — a duration it accepted, an
   * output count it validated — so confirming with anything else changes the
   * hash and fails verification. Binding the request as sent would let a client
   * quote one thing and confirm another.
   */
  const { token } = issuePlanToken({
    userId,
    brief: {
      version: 1,
      originalPrompt: body.prompt,
      kind: "sequence",
      publicModelId: body.modelId ?? "",
      mode: body.mode ?? "continuous",
      durationSeconds: body.durationSeconds ?? 5,
      outputs: body.outputs ?? 1,
      clips: quote.providerCalls,
    },
    modelId: body.modelId ?? "",
    quotedCredits: quote.creditCost,
    nowMs: Date.now(),
  });

  return { ok: true, quote, token };
}
