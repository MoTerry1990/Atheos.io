/**
 * The handful of environment values a browser is allowed to see.
 *
 * ## Why this exists at all, when `lib/env.ts` is meant to be the only reader
 *
 * It is the second sanctioned exception, alongside `prisma.config.ts`, and for
 * a reason that only shows up in a built bundle.
 *
 * `lib/env.ts` validates the whole environment with a single Zod schema. Import
 * it from a client component — even to read one `NEXT_PUBLIC_` value — and the
 * bundler cannot tree-shake a schema object, so **the entire schema ships to
 * the browser**. Not the secrets: server variables are `undefined` on the
 * client. But the *names* travel, and `REPLICATE_API_TOKEN` next to
 * `OPENAI_API_KEY` in a public JavaScript file tells any reader which vendors
 * run Atheos and which credentials it holds — the exact disclosure the public
 * model contract exists to prevent, arriving through the back door.
 *
 * That is not hypothetical. It was live: five client components imported
 * `job-mapper`, which imported `env` for one CDN base URL.
 *
 * ## Why reading `process.env` directly here is safe
 *
 * Next.js replaces `process.env.NEXT_PUBLIC_*` with a string literal at build
 * time. Each reference below compiles to the value and nothing else — no
 * object, no schema, no other key. A typo yields `undefined` rather than a
 * wrong value, and the callers below all handle absence already.
 *
 * ## The rule
 *
 * **`NEXT_PUBLIC_` values only.** Anything else belongs in `lib/env.ts` and
 * must never be read from a component that runs in a browser. If a client
 * component needs a server value, it needs a server component to pass it down
 * — that indirection is the whole point.
 */

/** Where generated assets are served from. */
export const R2_PUBLIC_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;

/**
 * The site's canonical origin.
 *
 * For metadata and structured data, which must name the canonical host rather
 * than whichever domain the page happens to be served from. Code running in a
 * browser that only needs "wherever I am" should use `window.location.origin`
 * instead — it is correct on preview deployments, where this is not.
 */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL;

/**
 * Clerk's publishable key.
 *
 * Public by design — it identifies the Clerk instance to a browser and grants
 * nothing on its own. It is here rather than in `lib/env.ts` because the
 * provider that needs it is a client component wrapping every authenticated
 * layout, which is how the whole schema reached three separate layout bundles.
 */
export const CLERK_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
