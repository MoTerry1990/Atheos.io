import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { UserJSON, WebhookEvent } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

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

function fullName(data: UserJSON): string | null {
  const name = [data.first_name, data.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || null;
}

/** Credits granted on sign-up. Matches the Starter tier on the pricing page. */
const SIGNUP_CREDIT_GRANT = 200;

async function handleUserCreated(data: UserJSON) {
  const email = primaryEmail(data);
  if (!email) {
    // Nothing useful to store, and email is unique-constrained. Swallow rather
    // than retry forever — a Clerk user with no email cannot be fixed by us.
    console.warn(`clerk webhook: user ${data.id} has no email address`);
    return;
  }

  // The ledger entry and the cached balance must commit together, or the
  // balance is a number nobody can explain. See docs/DECISIONS.md.
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      // Upsert, not create: Svix can deliver `user.created` twice with
      // different event ids if Clerk itself retries.
      where: { clerkId: data.id },
      create: {
        clerkId: data.id,
        email,
        name: fullName(data),
        imageUrl: data.image_url || null,
        creditBalance: SIGNUP_CREDIT_GRANT,
      },
      update: {
        email,
        name: fullName(data),
        imageUrl: data.image_url || null,
      },
    });

    const alreadyGranted = await tx.creditTransaction.findUnique({
      where: { idempotencyKey: `signup-grant:${data.id}` },
    });

    if (!alreadyGranted) {
      await tx.creditTransaction.create({
        data: {
          userId: user.id,
          amount: SIGNUP_CREDIT_GRANT,
          reason: "SIGNUP_GRANT",
          balanceAfter: user.creditBalance,
          idempotencyKey: `signup-grant:${data.id}`,
        },
      });
    }
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
}

async function handleUserDeleted(id: string) {
  // Cascades to generations, assets, collections and the credit ledger — see
  // the `onDelete: Cascade` relations in schema.prisma. Deleting the identity
  // must not leave orphaned personal data behind.
  await prisma.user.deleteMany({ where: { clerkId: id } });
}

export async function POST(request: NextRequest) {
  let event: WebhookEvent;

  try {
    event = await verifyWebhook(request);
  } catch (error) {
    console.error("clerk webhook: signature verification failed", error);
    // 400, not 500: this did not come from Clerk, so a retry is pointless.
    return new NextResponse("Invalid signature", { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Claim the event id first. A duplicate delivery violates the primary key
      // and lands in the catch below as an already-processed no-op.
      await tx.webhookEvent.create({
        data: {
          id: event.data.id ?? `${event.type}-unknown`,
          source: "clerk",
          eventType: event.type,
        },
      });
    });
  } catch {
    // Already processed. 200 so Svix stops retrying.
    return NextResponse.json({ status: "duplicate" });
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
    await prisma.webhookEvent
      .deleteMany({ where: { id: event.data.id ?? "" } })
      .catch(() => undefined);

    return new NextResponse("Processing failed", { status: 500 });
  }
}
