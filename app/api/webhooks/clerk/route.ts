import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { UserJSON, WebhookEvent } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";

import { guard } from "@/lib/api-guard";

import { env } from "@/lib/env";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { prisma } from "@/lib/prisma";
import { provisionUser } from "@/services/users/provision";
import { grantSignupCreditsIfEligible } from "@/services/users/signup-grant";

/**
 * Clerk → database user sync.
 *
 * Clerk owns identity; our `users` table is a mirror. This endpoint is what
 * keeps them in agreement.
 *
 * ## Verification is not optional
 *
 * `verifyWebhook` checks the Svix signature against
 * `CLERK_WEBHOOK_SIGNING_SECRET`. Without it, this route is an unauthenticated
 * "create a user with any email and any credit balance" API. It is public in
 * the middleware precisely *because* the signature is the authentication — a
 * session check would be wrong here, since Clerk has no session.
 *
 * ## Idempotency
 *
 * Svix retries on any non-2xx, and delivers out of order under load. So:
 *
 * 1. Insert the event id into `webhook_events` **first**. A duplicate hits the
 *    primary-key constraint and we return 200 without re-processing.
 * 2. Do the work.
 *
 * Doing it the other way round — process, then record — double-applies whenever
 * the response is lost in flight, which for a credit grant means free credits
 * for anyone who can trigger a retry.
 *
 * ## Failure handling
 *
 * A signature failure returns **400**: the request is not from Clerk and
 * retrying will not change that. A processing failure returns **500** so Svix
 * retries with backoff — and the event row is rolled back with it, so the retry
 * is not rejected as a duplicate.
 */

/** Clerk allows several emails; the primary one is the account's identity. */
function primaryEmail(data: UserJSON): string | null {
  const primary = data.email_addresses.find(
    (email) => email.id === data.primary_email_address_id,
  );
  return (
    primary?.email_address ?? data.email_addresses[0]?.email_address ?? null
  );
}

/**
 * Whether Clerk has confirmed the primary address.
 *
 * The grant waits for this. An unverified address costs nothing to invent, so
 * granting before the click is granting to anybody who can type.
 *
 * Read from the *primary* address specifically — a user can add a second,
 * unverified address without invalidating the one they signed up with.
 */
function primaryEmailVerified(data: UserJSON): boolean {
  const primary =
    data.email_addresses.find(
      (email) => email.id === data.primary_email_address_id,
    ) ?? data.email_addresses[0];

  return primary?.verification?.status === "verified";
}

function fullName(data: UserJSON): string | null {
  const name = [data.first_name, data.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || null;
}

async function handleUserCreated(data: UserJSON) {
  const email = primaryEmail(data);
  if (!email) {
    // Nothing useful to store, and email is unique-constrained. Swallow rather
    // than retry forever — a Clerk user with no email cannot be fixed by us.
    console.warn(`clerk webhook: user ${data.id} has no email address`);
    return;
  }

  // Shared with the sign-in path in `lib/auth.ts`, so a sign-up completes
  // whether or not this webhook is reachable. The grant amount, the upsert and
  // the ledger entry all live in one place — this route used to carry its own
  // SIGNUP_CREDIT_GRANT = 200 while the pricing page advertised 100.
  await provisionUser({
    clerkId: data.id,
    email,
    name: fullName(data),
    imageUrl: data.image_url || null,
    emailVerified: primaryEmailVerified(data),
  });
}

async function handleUserUpdated(data: UserJSON) {
  const email = primaryEmail(data);

  await prisma.user.updateMany({
    // updateMany, not update: it is a no-op when the row does not exist rather
    // than throwing. A `user.updated` can arrive before `user.created` was
    // successfully processed.
    where: { clerkId: data.id },
    data: {
      ...(email ? { email } : {}),
      name: fullName(data),
      imageUrl: data.image_url || null,
    },
  });

  /**
   * The moment the welcome credits are actually granted, for most accounts.
   *
   * A sign-up with an unverified address creates the row and no grant. Clicking
   * the verification link fires `user.updated` with the address now verified —
   * this is where that becomes credits.
   *
   * Safe to run on every `user.updated`, including the thousands that are just
   * a changed avatar: `grantSignupCreditsIfEligible` is exactly-once by two
   * unique constraints, so a repeat is one indexed lookup and a refusal.
   */
  if (!email || !primaryEmailVerified(data)) return;

  const user = await prisma.user.findUnique({
    where: { clerkId: data.id },
    select: { id: true },
  });
  if (!user) return;

  await grantSignupCreditsIfEligible({
    userId: user.id,
    clerkId: data.id,
    email,
    emailVerified: true,
  });
}

async function handleUserDeleted(id: string) {
  // Cascades to generations, assets, collections and the credit ledger — see
  // the `onDelete: Cascade` relations in schema.prisma. Deleting the identity
  // must not leave orphaned personal data behind.
  await prisma.user.deleteMany({ where: { clerkId: id } });
}

export async function POST(request: NextRequest) {
  // Rate limited before the signature is verified.
  //
  // Verification is HMAC over the whole body — cheap, but not free, and an
  // unauthenticated endpoint whose URL is discoverable is exactly the shape an
  // attacker floods. `auth: "none"` because the signature *is* the
  // authentication; `csrf: false` because a webhook sender is not a browser and
  // sends no Origin, so the cross-origin check would reject every real call.
  //
  // Keyed by IP, which is the only identity available here. The limit is set
  // well above either provider's real delivery rate.
  const gate = await guard(request, {
    policy: "sensitive",
    auth: "none",
    csrf: false,
    context: "POST /api/webhooks/clerk",
  });
  if (gate instanceof NextResponse) return gate;

  // Checked explicitly, mirroring the Stripe webhook.
  //
  // `verifyWebhook` reads this variable itself and throws when it is missing,
  // which landed in the catch below and logged "signature verification failed"
  // — sending whoever read that log hunting for a signature mismatch when the
  // actual problem was an unset variable. This is the single most consequential
  // misconfiguration in the project: without it no sign-up creates a user row,
  // and every downstream feature is confused about who exists.
  if (!env.CLERK_WEBHOOK_SIGNING_SECRET) {
    console.error(
      "clerk webhook received but CLERK_WEBHOOK_SIGNING_SECRET is unset",
    );
    return new NextResponse("Webhook verification is not configured", {
      status: 503,
    });
  }

  let event: WebhookEvent;

  try {
    event = await verifyWebhook(request);
  } catch (error) {
    console.error("clerk webhook: signature verification failed", error);
    // 400, not 500: this did not come from Clerk, so a retry is pointless.
    return new NextResponse("Invalid signature", { status: 400 });
  }

  // The **event** id, from Svix — not `event.data.id`, which is the *user* id.
  //
  // Using the subject id here was a serious bug. `user_abc` would be claimed by
  // the first `user.created`, and then every later `user.updated` for that same
  // person collided with it and was dropped as a "duplicate" — so a profile
  // synced exactly once and never again. Worse, the eventual `user.deleted`
  // collided too, leaving the row (and all their personal data) undeleted after
  // an account deletion.
  //
  // `svix-id` is unique per delivery, which is what idempotency actually needs.
  // Verification has already succeeded by this point, so the header is present;
  // refusing when it is absent is still better than inventing a key.
  const eventId = request.headers.get("svix-id");
  if (!eventId) {
    console.error("clerk webhook: verified request carried no svix-id header");
    return new NextResponse("Missing event id", { status: 400 });
  }

  try {
    // Claim the event id first. A duplicate delivery violates the primary key
    // and lands in the catch below as an already-processed no-op.
    await prisma.webhookEvent.create({
      data: { id: eventId, source: "clerk", eventType: event.type },
    });
  } catch (error) {
    // Only a primary-key collision means "already processed". A bare catch here
    // treated a dropped connection as a duplicate, returned 200, stopped Svix
    // retrying, and lost the signup grant silently.
    if (isUniqueViolation(error)) {
      return NextResponse.json({ status: "duplicate" });
    }

    console.error("clerk webhook: could not claim event id", error);
    // 500 so Svix retries. Nothing has been written yet, so a retry is safe.
    return new NextResponse("Could not record the event", { status: 500 });
  }

  try {
    switch (event.type) {
      case "user.created":
        await handleUserCreated(event.data);
        break;
      case "user.updated":
        await handleUserUpdated(event.data);
        break;
      case "user.deleted":
        if (event.data.id) await handleUserDeleted(event.data.id);
        break;
      default:
        // Subscribed to more events than we handle is fine — acknowledge and
        // move on rather than 500-ing and triggering endless retries.
        break;
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error(`clerk webhook: failed to process ${event.type}`, error);

    // Release the idempotency claim so the retry is not rejected as a
    // duplicate. Without this, one transient database blip means the user is
    // never synced and no retry can ever fix it.
    //
    // Must be the same `eventId` that was claimed above. It previously deleted
    // by `event.data.id ?? ""`, which no longer matches the claim — and in the
    // fallback case never matched anything at all, so the release silently did
    // nothing and the retry was rejected.
    await prisma.webhookEvent
      .deleteMany({ where: { id: eventId } })
      .catch(() => undefined);

    return new NextResponse("Processing failed", { status: 500 });
  }
}
