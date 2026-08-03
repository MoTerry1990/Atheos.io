import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { GenerationStatus } from "@/lib/generated/prisma/enums";

/**
 * Outbound webhooks.
 *
 * ## Why these exist
 *
 * The studio polls, and that is fine for a browser. An API caller cannot hold a
 * connection open for four minutes of video generation, and asking them to poll
 * makes our rate limit their problem. A callback is the difference between an
 * API somebody can build on and one they have to babysit.
 *
 * ## We sign, because we are asking to be trusted
 *
 * A receiver has no way to know a POST claiming to be from us actually is —
 * the URL is often guessable and the payload is not secret. So every delivery
 * carries an HMAC over the exact body, and the header format deliberately
 * mirrors Stripe's: a timestamp and a signature, with the timestamp inside the
 * signed material.
 *
 * The timestamp is what stops replay. Signing the body alone means a captured
 * delivery stays valid forever; signing `timestamp.body` means a receiver can
 * reject anything older than its tolerance.
 *
 * We are on the sending side of exactly this arrangement with Stripe and Clerk,
 * and both of those verifications are the reason the credit ledger is safe. It
 * would be strange to demand that of our vendors and not offer it ourselves.
 *
 * ## Delivery is best-effort, and failures never fail the job
 *
 * A generation that succeeded has succeeded. If the receiver is down, that is
 * their outage, not ours, and marking the job failed because we could not tell
 * anyone about it would destroy work the user has already paid for.
 */

/** How many delivery attempts before giving up. */
export const MAX_WEBHOOK_ATTEMPTS = 5;

/** Deliveries are quick or they are broken. */
const DELIVERY_TIMEOUT_MS = 10_000;

export interface WebhookPayload {
  event: "generation.completed" | "generation.failed" | "generation.canceled";
  generationId: string;
  status: GenerationStatus;
  createdAt: string;
  completedAt: string | null;
  outputs?: { url: string; mimeType: string }[];
  error?: string;
}

/**
 * The signature for a payload.
 *
 * Exported because it is the one piece a receiver has to reimplement, and a
 * documented function is better than prose describing one. Also the only part
 * that is testable without a network.
 */
export function signPayload(
  body: string,
  timestamp: number,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

/**
 * Constant-time comparison, for receivers implemented against this module.
 *
 * A plain `===` on a signature leaks how much of it was correct through timing.
 * That is a real attack on an HMAC, and it is cheap to avoid.
 */
export function verifySignature(
  body: string,
  timestamp: number,
  secret: string,
  candidate: string,
): boolean {
  const expected = signPayload(body, timestamp, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(candidate, "utf8");

  // `timingSafeEqual` throws on a length mismatch, which is itself a leak of
  // one bit. Checking length first and returning the same way is fine: the
  // length of an HMAC-SHA256 hex digest is public.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Is this URL somewhere we are willing to POST?
 *
 * **This is an SSRF control, not a validation nicety.** A webhook URL is
 * attacker-supplied and we fetch it from inside our own network — which is the
 * textbook shape of server-side request forgery. Without this a caller could
 * point a webhook at `http://169.254.169.254/` and have us fetch cloud instance
 * credentials on their behalf, or sweep internal services that have no
 * authentication because they were never meant to be reachable.
 *
 * Deliberately an allowlist of *shapes*, not a blocklist of addresses: a
 * blocklist has to enumerate every private range, every encoding of localhost,
 * and every DNS name that resolves into one.
 *
 * The remaining hole is honest and named in WORKER_REPORT.md: a public hostname
 * whose DNS resolves to a private address still passes. Closing it needs
 * resolution-time checking, which needs a custom agent.
 */
export function isDeliverableUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  // HTTPS only. A signed payload over plaintext is a signed payload anyone on
  // the path can read.
  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();

  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return false;
  }

  // Literal private and link-local IPv4, including the cloud metadata address.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false; // metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    return true;
  }

  // IPv6 literals: loopback, unique-local and link-local.
  if (host.startsWith("[")) {
    const inner = host.slice(1, -1);
    if (inner === "::1") return false;
    if (/^f[cd]/i.test(inner)) return false;
    if (/^fe80:/i.test(inner)) return false;
  }

  return true;
}

/**
 * Deliver one webhook.
 *
 * Records the outcome on the generation so a failed delivery is visible and
 * retryable rather than silently lost. Never throws.
 */
export async function deliver(
  generationId: string,
  url: string,
  payload: WebhookPayload,
): Promise<{ delivered: boolean; error?: string }> {
  const secret = env.WEBHOOK_SIGNING_SECRET;

  if (!secret) {
    // Refuse rather than send unsigned. An unsigned callback is one a receiver
    // cannot trust, and sending it teaches them to accept unsigned ones.
    const error = "WEBHOOK_SIGNING_SECRET is not set";
    await recordFailure(generationId, error);
    return { delivered: false, error };
  }

  if (!isDeliverableUrl(url)) {
    const error = "webhook URL is not deliverable";
    await recordFailure(generationId, error);
    return { delivered: false, error };
  }

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Atheos-Timestamp": String(timestamp),
        "Atheos-Signature": signPayload(body, timestamp, secret),
        "User-Agent": "Atheos-Webhook/1",
      },
      body,
      signal: controller.signal,
      // Never follow a redirect. A 302 to an internal address is how an SSRF
      // control that only checks the original URL gets bypassed.
      redirect: "manual",
      cache: "no-store",
    });

    if (response.status >= 200 && response.status < 300) {
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          webhookDelivered: true,
          webhookAttempts: { increment: 1 },
          webhookLastError: null,
        },
      });
      return { delivered: true };
    }

    const error = `receiver responded ${response.status}`;
    await recordFailure(generationId, error);
    return { delivered: false, error };
  } catch (cause) {
    const error =
      cause instanceof Error && cause.name === "AbortError"
        ? "receiver timed out"
        : "could not reach receiver";
    await recordFailure(generationId, error);
    return { delivered: false, error };
  } finally {
    clearTimeout(timer);
  }
}

async function recordFailure(generationId: string, error: string) {
  await prisma.generation
    .update({
      where: { id: generationId },
      data: {
        webhookAttempts: { increment: 1 },
        webhookLastError: error.slice(0, 500),
      },
    })
    .catch(() => undefined);
}

/**
 * Undelivered callbacks that are still worth retrying.
 *
 * Terminal jobs only — there is nothing to report about a job still running.
 */
export async function pendingDeliveries(limit = 20) {
  return prisma.generation.findMany({
    where: {
      webhookUrl: { not: null },
      webhookDelivered: false,
      webhookAttempts: { lt: MAX_WEBHOOK_ATTEMPTS },
      status: { in: ["SUCCEEDED", "FAILED", "CANCELED"] },
    },
    orderBy: { completedAt: "asc" },
    take: limit,
    select: {
      id: true,
      webhookUrl: true,
      status: true,
      error: true,
      createdAt: true,
      completedAt: true,
    },
  });
}
