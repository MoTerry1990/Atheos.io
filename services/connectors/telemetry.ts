import "server-only";

/**
 * What a connector call did, in terms that are safe to keep.
 *
 * ## Why this is a module rather than a `console.log` at each call site
 *
 * Because the interesting question is what must *not* be recorded, and that is
 * a decision worth making once. Logs outlive the incident they were added for:
 * they get shipped to a provider, read by whoever is on call, and kept for
 * months. A prompt in a log is a copy of a customer's work in a place nobody
 * chose to put it, and a token in a log is a credential at rest.
 *
 * So the shape below is a whitelist. There is no `metadata` escape hatch and
 * no `...rest`, because a field nobody vetted is exactly how a prompt ends up
 * in Datadog.
 *
 * ## What is safe, and why each one
 *
 * The API key is identified by its **record id**, never its value — enough to
 * answer "which integration is failing" without holding a credential. The
 * generation is identified by its public id, which is what a customer would
 * quote in a support message anyway.
 */

export type ConnectorAuth = "api_key" | "session";

export type IdempotencyOutcome =
  "first" | "replayed" | "conflict" | "not_applicable";

export interface ConnectorEvent {
  /** How the caller proved who they were. Never the credential itself. */
  auth: ConnectorAuth;
  /** Tool name for MCP, route path for REST. */
  operation: string;
  /** `ok`, or a machine-readable failure such as `model_unavailable`. */
  status: string;
  durationMs: number;
  /** Our own row id for the key. Never `atk_live_…`. */
  apiKeyRecordId?: string;
  idempotency?: IdempotencyOutcome;
  /** The public generation id, when one exists. */
  generationId?: string;
}

/**
 * Fields that must never appear, checked rather than trusted.
 *
 * A test asserts this list is non-empty and that `record` drops anything
 * matching it. Belt and braces: the type above already excludes them, but a
 * caller casting to `any` would slip past the compiler and not past this.
 */
const FORBIDDEN_KEYS = [
  "prompt",
  "token",
  "apiKey",
  "key",
  "authorization",
  "providerId",
  "predictionId",
  "assetUrl",
  "signedUrl",
  "url",
];

/** Strip anything not on the whitelist, whatever the caller passed. */
export function sanitise(event: Record<string, unknown>): ConnectorEvent {
  const allowed: (keyof ConnectorEvent)[] = [
    "auth",
    "operation",
    "status",
    "durationMs",
    "apiKeyRecordId",
    "idempotency",
    "generationId",
  ];

  const out: Record<string, unknown> = {};
  for (const field of allowed) {
    if (event[field] !== undefined) out[field] = event[field];
  }
  return out as unknown as ConnectorEvent;
}

/**
 * Record one connector call.
 *
 * Deliberately `console.info` rather than a logging library: Vercel collects
 * stdout, and one JSON line per call is greppable without another dependency
 * to configure and another place for a secret to be forwarded.
 */
export function recordConnectorEvent(event: ConnectorEvent): void {
  const safe = sanitise(event as unknown as Record<string, unknown>);
  console.info(JSON.stringify({ kind: "connector", ...safe }));
}

export { FORBIDDEN_KEYS };
