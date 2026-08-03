import "server-only";

import type { ProviderId } from "@/services/ai/types";

/**
 * Every provider Atheos knows about, and — the part that matters — whether it
 * is actually wired.
 *
 * ## Why this file exists separately from the registry
 *
 * The registry answers "which providers can serve a request right now". This
 * answers "which providers exist as a concept, and what is the honest status of
 * each". They are different questions, and conflating them is how a product
 * ends up listing eleven vendors on a pricing page while two of them work.
 *
 * `status` is the load-bearing field:
 *
 *   - **`implemented`** — an adapter exists, submits, polls and maps errors.
 *   - **`declared`** — the vendor is planned and its shape is understood, but
 *     no adapter exists. It is **never offered to a user**: the registry skips
 *     anything not `implemented`, so a declared provider cannot be selected,
 *     cannot be billed for, and cannot fail at submit.
 *
 * A `declared` entry is a commitment to an interface, not a claim of support.
 * It is here so that adding the adapter is a matter of writing one file, and so
 * the gap is countable rather than a matter of reading eleven imports.
 *
 * ## Nothing here calls a vendor
 *
 * This is a catalogue, not a client. It carries no credentials and makes no
 * requests. `envVar` names the variable whose presence enables a provider; the
 * adapter reads it, not this file.
 */

export type ProviderStatus = "implemented" | "declared";

/**
 * What the vendor is good at. Used by the fallback resolver to find an
 * equivalent when a provider is unhealthy — a video request must not fall back
 * to an image-only vendor.
 */
export type ProviderFamily = "image" | "video" | "multimodal";

export interface ProviderDescriptor {
  id: ProviderId;
  displayName: string;
  status: ProviderStatus;
  families: readonly ProviderFamily[];
  /** Environment variable whose presence enables the provider. */
  envVar: string;
  /**
   * Where this provider sits in fallback order. Lower is preferred.
   *
   * Ordering is by *operational* preference — breadth of model catalogue and
   * observed reliability — not by price. Price belongs in `cost.ts`, and mixing
   * the two would make a cheap-but-flaky vendor the default.
   */
  priority: number;
  /**
   * A one-line note about the vendor's shape, for whoever writes the adapter.
   * Deliberately short: anything longer is documentation that will go stale.
   */
  note: string;
}

/**
 * The eleven, in fallback-preference order.
 *
 * Two are implemented. The other nine are declared and unreachable, and this
 * file is the only place that number can be read off without counting imports.
 */
export const PROVIDER_CATALOGUE: readonly ProviderDescriptor[] = [
  {
    id: "replicate",
    displayName: "Replicate",
    status: "implemented",
    families: ["image", "video"],
    envVar: "REPLICATE_API_TOKEN",
    priority: 10,
    note: "Uniform run-a-model API across vendors; submit returns a prediction to poll.",
  },
  {
    id: "openai",
    displayName: "OpenAI",
    status: "implemented",
    families: ["image", "multimodal"],
    envVar: "OPENAI_API_KEY",
    priority: 20,
    note: "Synchronous image generation returning base64; the adapter fakes a job id.",
  },
  {
    id: "fal",
    displayName: "Fal",
    status: "declared",
    families: ["image", "video"],
    envVar: "FAL_API_KEY",
    priority: 30,
    note: "Queue API with a status URL per request; closest in shape to Replicate.",
  },
  {
    id: "google",
    displayName: "Google Gemini",
    status: "declared",
    families: ["image", "video", "multimodal"],
    envVar: "GOOGLE_AI_API_KEY",
    priority: 40,
    // The adapter exists as of Sprint 19 and is registered, but has never run
    // against Google. `declared` keeps it unreachable until someone executes it
    // with a real key — see AI_PROVIDER_REPORT.md. Flipping this one field is
    // the whole promotion.
    note: "Adapter written (Sprint 19), never executed. generateContent returns inline base64.",
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    status: "declared",
    // Deliberately not image or video. Anthropic's models reason about images;
    // they do not generate them. Listing it as an image provider would make the
    // fallback resolver route a generation request to a vendor that cannot
    // serve it — see the note on `families` above.
    families: ["multimodal"],
    envVar: "ANTHROPIC_API_KEY",
    priority: 50,
    note: "Vision and text. No image or video generation — used for prompt work only.",
  },
  {
    id: "runway",
    displayName: "Runway",
    status: "declared",
    families: ["video"],
    envVar: "RUNWAY_API_KEY",
    priority: 60,
    note: "Task-based video API; submit returns a task id with its own status enum.",
  },
  {
    id: "luma",
    displayName: "Luma",
    status: "declared",
    families: ["video"],
    envVar: "LUMA_API_KEY",
    priority: 70,
    note: "Dream Machine generations API; keyframe-driven image-to-video.",
  },
  {
    id: "kling",
    displayName: "Kling",
    status: "declared",
    families: ["video"],
    envVar: "KLING_API_KEY",
    priority: 80,
    note: "Requires request signing rather than a bearer token.",
  },
  {
    id: "minimax",
    displayName: "Minimax",
    status: "declared",
    families: ["video"],
    envVar: "MINIMAX_API_KEY",
    priority: 90,
    note: "Two-step: poll for a file id, then resolve the file id to a URL.",
  },
  {
    id: "hailuo",
    displayName: "Hailuo",
    status: "declared",
    families: ["video"],
    envVar: "HAILUO_API_KEY",
    priority: 100,
    note: "Minimax's consumer-facing video line; expected to share its API shape.",
  },
  {
    id: "pika",
    displayName: "Pika",
    status: "declared",
    families: ["video"],
    envVar: "PIKA_API_KEY",
    priority: 110,
    note: "Access is gated; shape unconfirmed. Lowest priority for that reason.",
  },
] as const;

const BY_ID = new Map(PROVIDER_CATALOGUE.map((p) => [p.id, p]));

export function describeProvider(id: ProviderId): ProviderDescriptor | null {
  return BY_ID.get(id) ?? null;
}

/** Providers with a working adapter. The only ones a request can reach. */
export function implementedProviders(): readonly ProviderDescriptor[] {
  return PROVIDER_CATALOGUE.filter((p) => p.status === "implemented");
}

/** Providers named but not built. Countable, so the gap cannot be forgotten. */
export function declaredProviders(): readonly ProviderDescriptor[] {
  return PROVIDER_CATALOGUE.filter((p) => p.status === "declared");
}

/**
 * Candidates for a fallback, in preference order.
 *
 * Filtered by family so a video request never lands on an image-only vendor,
 * and excluding the provider that just failed.
 */
export function fallbackCandidates(
  family: ProviderFamily,
  exclude: ProviderId,
): readonly ProviderDescriptor[] {
  return PROVIDER_CATALOGUE.filter(
    (p) =>
      p.id !== exclude &&
      p.status === "implemented" &&
      p.families.includes(family),
  ).sort((a, b) => a.priority - b.priority);
}
