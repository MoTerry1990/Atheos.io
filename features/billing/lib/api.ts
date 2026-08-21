import { ApiError, request } from "@/lib/http";
import type {
  PackDefinition,
  PlanDefinition,
} from "@/services/billing/catalogue";
import type {
  BillingInterval,
  CreditReason,
  Modality,
  PlanTier,
  SubscriptionStatus,
} from "@/lib/generated/prisma/enums";

/**
 * The billing client.
 *
 * Reuses the studio's `ApiError` so a component showing a failure does not have
 * to ask which feature produced it.
 *
 * Types are imported from `services/billing/catalogue` — the env-free half of
 * the catalogue. Importing from `plans` would pull server environment variables
 * into the browser bundle.
 */

export { ApiError };

export interface Entitlement {
  tier: PlanTier;
  interval: BillingInterval;
  status: SubscriptionStatus | null;
  active: boolean;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  scheduledTier: PlanTier | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  /**
   * What the account is billed for, as distinct from what it may use.
   *
   * Mirrors `Entitlement` in `services/billing/subscription.ts`; the two are
   * separate declarations because this one crosses to the browser. Null when
   * nothing is billed.
   */
  billedTier: PlanTier | null;
  /** True when access comes from a role rather than a payment. */
  complimentary: boolean;
}

export interface InvoiceSummary {
  id: string;
  number: string | null;
  status: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  created: number;
  periodStart: number | null;
  periodEnd: number | null;
  hostedUrl: string | null;
  pdfUrl: string | null;
  description: string | null;
}

export interface UsageReport {
  periodStart: number;
  periodEnd: number;
  creditsSpent: number;
  creditsGranted: number;
  generations: number;
  byModality: { modality: Modality; credits: number; generations: number }[];
  byModel: { model: string; credits: number; generations: number }[];
}

export interface HistoryEntry {
  id: string;
  amount: number;
  reason: CreditReason;
  balanceAfter: number;
  stripeReference: string | null;
  createdAt: number;
  generation: {
    id: string;
    model: string;
    operation: string;
    modality: Modality;
  } | null;
}

export interface BillingSummary {
  configured: boolean;
  problems: string[];
  creditBalance: number;
  entitlement: Entitlement;
  plans: (PlanDefinition & { priceIds: { month?: string; year?: string } })[];
  packs: (PackDefinition & { priceId?: string })[];
  usage: UsageReport;
  /** Null when Stripe could not be reached — distinct from an empty list. */
  invoices: InvoiceSummary[] | null;
  history: HistoryEntry[];
}

export function loadBilling() {
  return request<BillingSummary>("/api/billing");
}

export function startSubscriptionCheckout(
  tier: "CREATOR" | "PRO" | "STUDIO",
  interval: BillingInterval,
) {
  return request<{ url: string }>("/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ kind: "subscription", tier, interval }),
  });
}

export function startPackCheckout(packId: string) {
  return request<{ url: string }>("/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ kind: "pack", packId }),
  });
}

export function changePlan(tier: PlanTier, interval: BillingInterval) {
  return request<{ ok: true; effective?: string; entitlement: Entitlement }>(
    "/api/billing/subscription",
    {
      method: "PATCH",
      body: JSON.stringify({ action: "change", tier, interval }),
    },
  );
}

export function cancelPlan() {
  return request<{ ok: true; effective?: string; entitlement: Entitlement }>(
    "/api/billing/subscription",
    { method: "PATCH", body: JSON.stringify({ action: "cancel" }) },
  );
}

export function resumePlan() {
  return request<{ ok: true; effective?: string; entitlement: Entitlement }>(
    "/api/billing/subscription",
    { method: "PATCH", body: JSON.stringify({ action: "resume" }) },
  );
}

export function openPortal() {
  return request<{ url: string }>("/api/billing/portal", { method: "POST" });
}
