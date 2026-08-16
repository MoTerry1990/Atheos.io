import "server-only";

/**
 * Structured events for the financial and abuse-control paths.
 *
 * ## What this is for
 *
 * When the spending breaker trips at 2am, the question is "what did it see?".
 * `console.log("blocked")` scattered through five modules cannot answer that.
 * A single emitter with a fixed shape can, and it can be pointed at a real sink
 * later by changing one function instead of every call site.
 *
 * Deliberately **not** a logging library. There is no dependency to add, no
 * transport to configure, and nothing here that a JSON line on stdout does not
 * already do — Vercel captures stdout, and that is the sink today.
 *
 * ## The redaction is the point
 *
 * Every value written here passes through `scrub()`. That is not politeness
 * about log hygiene: these events fire on the credit, rate-limit and provider
 * paths, which are precisely the places where an API key, an Authorization
 * header or a customer's prompt is in scope. A log line is a copy of data in a
 * place with different access controls, and it is the copy that outlives the
 * incident.
 *
 * The rule is a deny-list on key *names* plus a length ceiling on strings. A
 * deny-list is weaker than an allow-list and it is what fits a call site that
 * passes arbitrary context; the length ceiling is the backstop, because the
 * things worth stealing — tokens, headers, prompts — are all long.
 */

/**
 * Event names, enumerated so they can be reviewed as a set and grepped as a
 * closed list. A string union rather than an enum: these are wire values.
 */
export type EventName =
  // Credit lifecycle
  | "credit.reserve"
  | "credit.reserve.insufficient"
  | "credit.capture"
  | "credit.release"
  | "credit.release.refused"
  // Sprint 5C.1: the legacy-spend reversal, and the guard that refuses
  // to reverse anything once a durable asset exists.
  | "credit.refund"
  | "credit.refund.refused"
  // Abuse controls
  | "limit.rate_blocked"
  | "limit.concurrency_blocked"
  | "limit.store_unavailable"
  // Financial controls
  | "spend.threshold"
  | "spend.blocked"
  | "spend.emergency_stop"
  | "model.disabled"
  | "plan.ineligible";

/**
 * Keys whose values never reach a log, whatever they contain.
 *
 * Matched case-insensitively as substrings, so `stripeSecretKey`,
 * `x-api-key` and `AUTHORIZATION` are all caught by one entry each.
 */
const FORBIDDEN_KEY_FRAGMENTS = [
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "credential",
  "signature",
  "prompt",
];

/**
 * Longest string that survives intact.
 *
 * 200 characters is enough for a model id, a reason code or a URL path, and
 * short enough that a leaked key or a pasted prompt is truncated rather than
 * captured. Truncation is marked so a reader knows they are seeing part of it.
 */
const MAX_STRING = 200;

function scrubValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}…[truncated]`
      : value;
  }

  if (typeof value === "number" || typeof value === "boolean") return value;

  // Depth-limited: a deeply nested object in a log line is unreadable anyway,
  // and unbounded recursion over caller-supplied data is its own hazard.
  if (depth >= 3) return "[nested]";

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => scrubValue(entry, depth + 1));
  }

  if (typeof value === "object") {
    return scrub(value as Record<string, unknown>, depth + 1);
  }

  // Functions, symbols, bigints. BigInt in particular is not JSON-serialisable
  // and would throw inside JSON.stringify, taking the caller down with it.
  return typeof value === "bigint" ? value.toString() : "[unserialisable]";
}

export function scrub(
  payload: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    const lowered = key.toLowerCase();

    if (
      FORBIDDEN_KEY_FRAGMENTS.some((fragment) => lowered.includes(fragment))
    ) {
      out[key] = "[redacted]";
      continue;
    }

    out[key] = scrubValue(value, depth);
  }

  return out;
}

/**
 * Emit one event.
 *
 * Never throws. An observability call that can fail takes down the thing it was
 * observing, and these sit on the generation path — a malformed payload must
 * not become a 500 on a request that was otherwise fine.
 */
export function emit(name: EventName, payload: Record<string, unknown> = {}) {
  try {
    const line = JSON.stringify({
      evt: name,
      at: new Date().toISOString(),
      ...scrub(payload),
    });

    // stderr for the ones that need attention, stdout for the rest. Vercel
    // splits them, so an alert can be built on stderr without matching strings.
    if (
      name === "spend.emergency_stop" ||
      name === "spend.blocked" ||
      name === "limit.store_unavailable"
    ) {
      console.error(line);
    } else {
      /**
       * `console.log`, deliberately, against the project's `no-console` rule.
       *
       * The rule allows `warn` and `error` because those are the ones worth
       * reading. These events are the opposite: high-volume, structured, and
       * meant for a log drain rather than a person. Promoting a routine
       * `credit.reserve` to `warn` would make every successful generation look
       * like a problem and train the reader to ignore warnings.
       *
       * This is the only `console.log` in the codebase that is not a mistake,
       * which is why it is disabled here by name rather than by loosening the
       * rule for the whole file.
       */
      // eslint-disable-next-line no-console
      console.log(line);
    }
  } catch {
    // Deliberately silent. There is nowhere useful to report a failure to
    // report, and a second attempt would fail the same way.
  }
}
