import "server-only";

import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { isBillingConfigured } from "@/services/billing/plans";
import type { Modality } from "@/lib/generated/prisma/enums";

/**
 * Invoices and usage.
 *
 * Two different questions that look like one:
 *
 *   **Invoices** — what were you charged? Stripe's answer, fetched live.
 *   **Usage**    — what did you spend it on? Ours, from generations.
 *
 * They are kept apart because they come from different systems and disagree in
 * normal operation: an invoice is monthly, usage is continuous, and a refunded
 * generation costs nothing while still having happened.
 */

export interface InvoiceSummary {
  id: string;
  number: string | null;
  status: string;
  /** Minor units. */
  amountDue: number;
  amountPaid: number;
  currency: string;
  created: number;
  periodStart: number | null;
  periodEnd: number | null;
  /** Stripe-hosted receipt. Short-lived by design — never stored. */
  hostedUrl: string | null;
  pdfUrl: string | null;
  description: string | null;
}

/**
 * This customer's invoices, from Stripe.
 *
 * Not mirrored into our database, unlike subscriptions. An invoice is
 * immutable history that Stripe already stores, indexes and renders as a PDF,
 * and the only reason to copy it would be to render a list we can render from
 * theirs. Subscriptions are mirrored because they are read on every request;
 * invoices are read when somebody opens the billing page.
 *
 * The hosted URLs are returned to the client and never persisted — they are
 * signed and expire, so a stored one is a link that breaks.
 */
export async function listInvoices(
  stripeCustomerId: string | null,
  limit = 12,
): Promise<InvoiceSummary[]> {
  if (!stripeCustomerId || !isBillingConfigured()) return [];

  const invoices = await stripe.invoices.list({
    customer: stripeCustomerId,
    limit: Math.min(limit, 100),
  });

  return invoices.data.map((invoice) => ({
    id: invoice.id ?? "",
    number: invoice.number,
    status: invoice.status ?? "draft",
    amountDue: invoice.amount_due,
    amountPaid: invoice.amount_paid,
    currency: invoice.currency,
    created: invoice.created * 1000,
    periodStart: invoice.period_start ? invoice.period_start * 1000 : null,
    periodEnd: invoice.period_end ? invoice.period_end * 1000 : null,
    hostedUrl: invoice.hosted_invoice_url ?? null,
    pdfUrl: invoice.invoice_pdf ?? null,
    description: invoice.description,
  }));
}

export interface UsageBreakdownRow {
  modality: Modality;
  credits: number;
  generations: number;
}

export interface UsageReport {
  periodStart: number;
  periodEnd: number;
  /**
   * Whether the window above is the subscriber's **billing period**.
   *
   * False means the trailing-30-day fallback, which is a reporting convenience
   * and not a billing month. The distinction decides whether a plan's monthly
   * grant may be used as a denominator: comparing spend in an arbitrary 30-day
   * window against "500 credits monthly" states a relationship that does not
   * exist.
   */
  isBillingPeriod: boolean;
  /** Net credits consumed — spend less refunds. */
  creditsSpent: number;
  creditsGranted: number;
  generations: number;
  byModality: UsageBreakdownRow[];
  byModel: { model: string; credits: number; generations: number }[];
}

/**
 * What this user consumed over a period.
 *
 * ## Net of refunds, and the two halves come from different tables
 *
 * The **total** comes from the ledger, because the ledger is what actually
 * moved the balance: a failed generation is debited and then refunded, and a
 * number that ignored the refund would tell somebody they spent credits they
 * still have.
 *
 * The **breakdown** comes from succeeded generations, because a refunded
 * failure has no meaningful modality to attribute cost to — it cost nothing.
 * The two therefore agree in the normal case and diverge slightly when
 * something is mid-flight, which is the honest behaviour: money already
 * debited but not yet settled belongs in the total and not in the breakdown.
 *
 * Deliberately **not** wrapped in `$transaction`. Prisma's `groupBy` result
 * types do not survive it — a wart this codebase has already hit once — and
 * there is nothing here that needs to be atomic, since it is all reads.
 */
export async function getUsage(
  userId: string,
  period: { start: Date; end: Date; isBillingPeriod?: boolean },
): Promise<UsageReport> {
  const window = { gte: period.start, lt: period.end };

  const [ledger, byModality, byModel, totals] = await Promise.all([
    prisma.creditTransaction.groupBy({
      by: ["reason"],
      where: { userId, createdAt: window },
      _sum: { amount: true },
    }),
    prisma.generation.groupBy({
      by: ["modality"],
      where: { userId, status: "SUCCEEDED", createdAt: window },
      _sum: { creditsCost: true },
      _count: { _all: true },
    }),
    prisma.generation.groupBy({
      by: ["model"],
      where: { userId, status: "SUCCEEDED", createdAt: window },
      _sum: { creditsCost: true },
      _count: { _all: true },
      orderBy: { _sum: { creditsCost: "desc" } },
      take: 8,
    }),
    prisma.generation.count({ where: { userId, createdAt: window } }),
  ]);

  const sumOf = (reason: string) =>
    ledger.find((row) => row.reason === reason)?._sum.amount ?? 0;

  // Spend is stored negative, refunds positive. Adding them nets correctly and
  // the sign flip makes "spent" a positive number to display.
  const spend = sumOf("GENERATION_SPEND");
  const refunds = sumOf("GENERATION_REFUND");

  return {
    periodStart: period.start.getTime(),
    periodEnd: period.end.getTime(),
    isBillingPeriod: period.isBillingPeriod ?? false,
    creditsSpent: Math.max(0, -(spend + refunds)),
    creditsGranted:
      sumOf("SUBSCRIPTION_GRANT") +
      sumOf("PACK_PURCHASE") +
      sumOf("SIGNUP_GRANT") +
      sumOf("MANUAL_ADJUSTMENT"),
    generations: totals,
    byModality: byModality.map((row) => ({
      modality: row.modality,
      credits: row._sum.creditsCost ?? 0,
      generations: row._count._all,
    })),
    byModel: byModel.map((row) => ({
      model: row.model,
      credits: row._sum.creditsCost ?? 0,
      generations: row._count._all,
    })),
  };
}

/**
 * The period usage should be reported over.
 *
 * A subscriber's billing period, so the number lines up with the invoice they
 * are looking at. Everyone else gets the last 30 days, because "this month" for
 * someone with no subscription is an arbitrary boundary that makes usage look
 * like it resets when nothing does.
 */
export function usagePeriodFor(entitlement: {
  currentPeriodStart?: number | null;
  currentPeriodEnd?: number | null;
}): { start: Date; end: Date; isBillingPeriod: boolean } {
  if (entitlement.currentPeriodStart && entitlement.currentPeriodEnd) {
    return {
      start: new Date(entitlement.currentPeriodStart),
      end: new Date(entitlement.currentPeriodEnd),
      isBillingPeriod: true,
    };
  }

  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  // A rolling window, not a billing month. Callers must not compare it to a
  // monthly allowance — see `isBillingPeriod` on `UsageReport`.
  return { start, end, isBillingPeriod: false };
}
