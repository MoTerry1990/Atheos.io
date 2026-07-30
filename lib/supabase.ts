import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

/**
 * Supabase clients.
 *
 * ## What Supabase is used for here
 *
 * Managed PostgreSQL, and later Realtime for live generation-job updates.
 * **Not** authentication — Clerk owns identity. See `docs/DECISIONS.md`.
 *
 * That split has a consequence worth stating plainly: because sessions are
 * Clerk's, Supabase row-level security cannot recognise our users out of the
 * box. Authorisation is therefore enforced in our own service layer, on the
 * server, with Prisma. Do not reach for the anon key and RLS as a shortcut —
 * it will not know who the caller is.
 *
 * Almost all data access should go through `lib/prisma.ts`. Use these clients
 * only for Supabase-specific capabilities Prisma does not cover.
 */

function requireSupabaseConfig() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY — see .env.example.",
    );
  }

  return { url, anonKey };
}

/**
 * Browser client. Constrained by row-level security, which is the only thing
 * making the anon key safe to publish.
 */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = requireSupabaseConfig();
  return createBrowserClient(url, anonKey);
}

/**
 * Service-role client. Bypasses row-level security entirely.
 *
 * Every call made with this client is unauthenticated as far as the database is
 * concerned, so the *caller* is responsible for having established who the user
 * is and what they may touch. Never import this into a client component.
 */
export function createSupabaseAdminClient() {
  const { url } = requireSupabaseConfig();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — cannot create an admin client.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      // No browser, no session to persist or refresh.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
