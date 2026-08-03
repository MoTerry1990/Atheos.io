/**
 * Handles.
 *
 * Pure — no `env`, no `server-only` — so the sign-up form can validate as the
 * user types without a round trip, using the same rules the server enforces.
 * Two implementations of "is this handle allowed" would eventually disagree,
 * and the disagreement would surface as a form that accepts something the API
 * then rejects.
 */

/**
 * Reserved. Profiles live at `/u/{handle}`, so these are not route collisions —
 * they are impersonation and confusion risks.
 *
 * `admin`, `support` and `atheos` are the ones that matter: a handle that looks
 * official is the cheapest phishing tool a platform can hand out. The rest are
 * words a user would reasonably read as part of the product rather than as a
 * person.
 */
const RESERVED = new Set([
  "admin",
  "administrator",
  "api",
  "atheos",
  "billing",
  "dashboard",
  "explore",
  "featured",
  "help",
  "legal",
  "library",
  "marketplace",
  "me",
  "moderator",
  "official",
  "post",
  "posts",
  "pricing",
  "privacy",
  "profile",
  "projects",
  "root",
  "security",
  "settings",
  "signin",
  "signup",
  "staff",
  "studio",
  "support",
  "system",
  "team",
  "terms",
  "trending",
  "u",
  "user",
  "users",
]);

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 24;

export type HandleProblem =
  | "too_short"
  | "too_long"
  | "invalid_characters"
  | "edge_punctuation"
  | "reserved";

export const HANDLE_MESSAGES: Record<HandleProblem, string> = {
  too_short: `Handles are at least ${HANDLE_MIN} characters.`,
  too_long: `Handles are at most ${HANDLE_MAX} characters.`,
  invalid_characters: "Use letters, numbers, underscores and hyphens only.",
  edge_punctuation: "Handles cannot start or end with a hyphen or underscore.",
  reserved: "That handle is reserved.",
};

/**
 * Normalise before comparing or storing.
 *
 * Lower-cased, always. `Ada` and `ada` resolving to different profiles is an
 * impersonation vector, not a feature — and the unique index cannot see the
 * difference unless the value going in is already normalised.
 */
export function normaliseHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Returns null when the handle is fine. */
export function validateHandle(raw: string): HandleProblem | null {
  const handle = normaliseHandle(raw);

  if (handle.length < HANDLE_MIN) return "too_short";
  if (handle.length > HANDLE_MAX) return "too_long";
  // ASCII only. Unicode handles look inclusive and are a homograph attack
  // surface — Cyrillic "а" beside Latin "a" is indistinguishable in most fonts,
  // and the whole point of a handle is that it identifies one person.
  if (!/^[a-z0-9_-]+$/.test(handle)) return "invalid_characters";
  if (/^[-_]|[-_]$/.test(handle)) return "edge_punctuation";
  if (RESERVED.has(handle)) return "reserved";

  return null;
}

export function isReserved(handle: string): boolean {
  return RESERVED.has(normaliseHandle(handle));
}

/** A URL-safe slug for a shared collection. */
export function slugify(raw: string, fallback = "collection"): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return slug || fallback;
}
