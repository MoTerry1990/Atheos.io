"use client";

import {
  AlertTriangle,
  Coins,
  CreditCard,
  ExternalLink,
  FileText,
  Info,
  Plus,
  Receipt,
  RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/state";
import { PlanCard } from "@/features/billing/components/plan-card";
import { UsagePanel } from "@/features/billing/components/usage-panel";
import { ApiError, type BillingSummary } from "@/features/billing/lib/api";
import { useBillingApi } from "@/features/billing/lib/api-context";
import { formatMoney, rankOf } from "@/services/billing/catalogue";
import type { BillingInterval, PlanTier } from "@/lib/generated/prisma/enums";
import { formatRelativeTime } from "@/utils/format";
import { toast } from "@/lib/toast";

/**
 * Billing.
 *
 * ## Everything loads in one request
 *
 * Plan, credits, usage, invoices and history are read together because they are
 * read together. Five endpoints would mean five spinners and a window in which
 * the usage bar and the plan card describe different periods.
 *
 * ## The state that matters is stated, not implied
 *
 * Past due, cancelling at the period end, a scheduled downgrade, and billing
 * not being configured at all are each called out in a banner. Every one of
 * them is a case where the buttons alone would be misleading — a "Current plan"
 * badge on a subscription that ends on Friday is technically true and useless.
 *
 * ## Nothing here grants anything
 *
 * Checkout hands back a URL and the browser navigates to Stripe. Credits and
 * plan changes land later, over the webhook. So after returning from checkout
 * this screen refetches rather than assuming, and says the change may take a
 * moment — because it genuinely may.
 */

const STATUS_COPY: Record<
  string,
  { label: string; variant: "success" | "warning" | "danger" | "info" }
> = {
  TRIALING: { label: "Trial", variant: "info" },
  ACTIVE: { label: "Active", variant: "success" },
  PAST_DUE: { label: "Payment failed", variant: "warning" },
  UNPAID: { label: "Unpaid", variant: "danger" },
  CANCELED: { label: "Cancelled", variant: "danger" },
  INCOMPLETE: { label: "Incomplete", variant: "warning" },
  INCOMPLETE_EXPIRED: { label: "Expired", variant: "danger" },
  PAUSED: { label: "Paused", variant: "warning" },
};

export function BillingScreen({
  initialNotice,
  highlightTier = null,
  initialInterval = null,
}: {
  /** `?checkout=` or `?purchase=` from Stripe's redirect. */
  initialNotice?: "checkout-success" | "purchase-success" | "cancelled" | null;
  /** A plan chosen on the pricing page before signing up. */
  highlightTier?: PlanTier | null;
  initialInterval?: BillingInterval | null;
}) {
  const api = useBillingApi();

  const [data, setData] = useState<BillingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Monthly only — see the note beside the Plans heading.
  const [interval] = useState<BillingInterval>(initialInterval ?? "MONTH");
  const [pendingTier, setPendingTier] = useState<PlanTier | null>(null);
  const [pendingPack, setPendingPack] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<PlanTier | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.loadBilling());
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not load your billing details.",
      );
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // The webhook that grants credits can land after the redirect does. Rather
  // than showing a stale balance and hoping, say so and refetch once.
  useEffect(() => {
    if (!initialNotice || initialNotice === "cancelled") return;

    toast.success(
      initialNotice === "purchase-success" ? "Payment received" : "Thank you",
      "Your account updates within a few seconds of Stripe confirming it.",
    );

    const timer = setTimeout(() => void load(), 2500);
    return () => clearTimeout(timer);
  }, [initialNotice, load]);

  async function withBusy<T>(
    action: () => Promise<T>,
    failure: string,
  ): Promise<T | null> {
    setBusy(true);
    try {
      return await action();
    } catch (cause) {
      toast.error(failure, {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function selectPlan(tier: PlanTier) {
    if (!data) return;

    const current = data.entitlement;

    // Resuming a cancellation is not a plan change — the plan never changed.
    if (tier === current.tier && current.cancelAtPeriodEnd) {
      setPendingTier(tier);
      const result = await withBusy(
        () => api.resumePlan(),
        "Could not resume your subscription",
      );
      setPendingTier(null);
      if (result) {
        toast.success("Subscription resumed", "It will renew as normal.");
        await load();
      }
      return;
    }

    // No subscription yet: this is a purchase, so it goes through Checkout.
    if (!current.stripeSubscriptionId && tier !== "FREE") {
      setPendingTier(tier);
      const result = await withBusy(
        () =>
          api.startSubscriptionCheckout(
            tier as "CREATOR" | "PRO" | "STUDIO",
            interval,
          ),
        "Could not start checkout",
      );
      setPendingTier(null);
      if (result) window.location.href = result.url;
      return;
    }

    // A downgrade removes capability, so it is confirmed. An upgrade is not:
    // it takes effect immediately, costs money the price card already stated,
    // and is reversible in one click.
    // Compared against the billed plan. An owner on complimentary Studio who
    // pays for Creator is not "downgrading" by staying on Creator.
    const comparedTo = current.complimentary
      ? (current.billedTier ?? tier)
      : current.tier;

    if (rankOf(tier) < rankOf(comparedTo)) {
      setConfirming(tier);
      return;
    }

    await applyChange(tier);
  }

  async function applyChange(tier: PlanTier) {
    setPendingTier(tier);
    const result = await withBusy(
      () =>
        tier === "FREE" ? api.cancelPlan() : api.changePlan(tier, interval),
      "Could not change your plan",
    );
    setPendingTier(null);

    if (result) {
      toast.success(
        tier === "FREE" ? "Subscription cancelled" : "Plan changed",
        result.effective === "period_end"
          ? "You keep everything until the end of the period you have paid for."
          : "Your new allowance appears once Stripe confirms the payment.",
      );
      await load();
    }
  }

  if (error) {
    return (
      <ErrorState
        title="Could not load billing"
        description={error}
        onRetry={() => void load()}
      />
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  const { entitlement, usage } = data;

  /**
   * Access and billing are two different questions, and this screen asks both.
   *
   * `entitlement.tier` is what the account may *use*. For an owner that is a
   * complimentary Studio grant which no subscription stands behind.
   * `entitlement.billedTier` is what the account is actually *charged* for.
   *
   * Reading the first and calling it "current plan" is what produced the
   * Sprint 6B defect: an owner who had just bought Creator was shown
   * "Current plan: Studio" and offered a move to the plan they had paid for
   * minutes earlier.
   */
  const accessPlan =
    data.plans.find((plan) => plan.tier === entitlement.tier) ?? data.plans[0];

  const billedPlan =
    entitlement.billedTier === null
      ? null
      : (data.plans.find((plan) => plan.tier === entitlement.billedTier) ??
        null);

  /**
   * The tier every billing *control* compares against.
   *
   * For a complimentary account that is the billed plan — so Creator reads as
   * current and offers no move. For everyone else it stays `tier`, which
   * correctly falls back to Free when a subscription lapses; using `billedTier`
   * there would mark a plan "current" that the customer can no longer use.
   *
   * Null for an owner with nothing billed, which is right: no card is current,
   * because nothing is being paid for.
   */
  const billingTier: PlanTier | null = entitlement.complimentary
    ? entitlement.billedTier
    : entitlement.tier;

  const currentPlan = accessPlan;

  /**
   * The plan whose recurring grant actually lands in the ledger.
   *
   * `invoice.paid` grants `planFor(tier).monthlyCredits` for the **subscribed**
   * plan, so that is the only plan whose allowance is a real number for this
   * account. For an ordinary customer it is the same plan they have access to;
   * for an owner it is the one they pay for, and complimentary Studio grants
   * nothing at all.
   */
  const grantingPlan =
    billedPlan ?? (entitlement.complimentary ? null : accessPlan);

  /**
   * Whether a monthly grant may be used as a denominator at all.
   *
   * Three conditions, and all of them are necessary:
   *
   *   1. The usage window is the **billing period**, not the trailing-30-day
   *      fallback. Comparing spend in an arbitrary window to "500 credits
   *      monthly" asserts a relationship that does not exist.
   *   2. A plan is actually granting credits — complimentary access grants
   *      none, so there is no denominator to show.
   *   3. That grant is **recurring**. Free's 100 credits are a one-time
   *      welcome grant, and rendering "82 of 100 used this period" would
   *      invent a monthly allowance the Free plan has never had.
   *
   * When any fails the bar is dropped and the facts are stated separately,
   * which is the honest presentation of a pooled wallet.
   */
  const allowanceApplies =
    usage.isBillingPeriod &&
    grantingPlan !== null &&
    grantingPlan.tier !== "FREE" &&
    grantingPlan.monthlyCredits !== null;

  /** "Creator grants 500 credits monthly" — never a bare number. */
  const allowanceNote =
    grantingPlan && grantingPlan.monthlyCredits !== null
      ? grantingPlan.tier === "FREE"
        ? `${grantingPlan.name} includes ${grantingPlan.monthlyCredits.toLocaleString("en-US")} credits, once`
        : `${grantingPlan.name} grants ${grantingPlan.monthlyCredits.toLocaleString("en-US")} credits monthly`
      : entitlement.complimentary
        ? "Complimentary access grants no credits — spending draws on your balance"
        : null;
  const status = entitlement.status ? STATUS_COPY[entitlement.status] : null;
  const renewal = entitlement.currentPeriodEnd
    ? new Date(entitlement.currentPeriodEnd)
    : null;

  return (
    <div className="space-y-8">
      {/* Configuration first: with no Stripe keys nothing below can work, and
          a row of buttons that fail on click is worse than an explanation. */}
      {!data.configured ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 p-3">
          <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 text-xs">
            <p className="font-medium">Billing is not configured.</p>
            <p className="mt-0.5 text-muted-foreground">
              Plans are shown for reference and nothing can be purchased. Set{" "}
              {data.problems.length > 0 ? (
                <code className="font-mono">{data.problems.join(", ")}</code>
              ) : (
                "the Stripe environment variables"
              )}
              .
            </p>
          </div>
        </div>
      ) : null}

      {entitlement.status === "PAST_DUE" ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 p-3"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-warning"
            aria-hidden
          />
          <div className="min-w-0 text-xs">
            <p className="font-medium">Your last payment did not go through.</p>
            <p className="mt-0.5 text-muted-foreground">
              You still have full access while we retry. Update your card to
              avoid interruption.
            </p>
          </div>
        </div>
      ) : null}

      {/* Current plan */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-2xs font-medium tracking-wider text-muted-foreground uppercase">
              {entitlement.complimentary ? "Effective access" : "Current plan"}
            </p>
            <p className="mt-1 flex items-center gap-2 text-lg font-semibold">
              {currentPlan.name}
              {entitlement.complimentary ? (
                <Badge variant="outline" size="sm">
                  Complimentary owner access
                </Badge>
              ) : null}
              {status && !entitlement.complimentary ? (
                <Badge variant={status.variant} size="sm" dot>
                  {status.label}
                </Badge>
              ) : null}
            </p>

            {/**
             * What is actually being charged, stated separately.
             *
             * Only rendered for a complimentary account, because for everyone
             * else it is the same plan named twice — and a screen that repeats
             * itself teaches people to stop reading it.
             */}
            {entitlement.complimentary ? (
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  Billed subscription:
                </span>{" "}
                {billedPlan ? (
                  <>
                    {billedPlan.name} — {formatMoney(billedPlan.monthly)}/month
                    {billedPlan.monthlyCredits !== null
                      ? ` · ${billedPlan.monthlyCredits.toLocaleString("en-US")} credits monthly`
                      : ""}
                    {status ? (
                      <>
                        {" "}
                        <Badge variant={status.variant} size="sm" dot>
                          {status.label}
                        </Badge>
                      </>
                    ) : null}
                  </>
                ) : (
                  "none"
                )}
              </p>
            ) : null}

            {entitlement.cancelAtPeriodEnd && renewal ? (
              <p className="mt-1 text-xs text-warning">
                Ends {renewal.toLocaleDateString()} — you keep everything until
                then.
              </p>
            ) : entitlement.scheduledTier &&
              entitlement.scheduledTier !== entitlement.tier &&
              renewal ? (
              <p className="mt-1 text-xs text-warning">
                Changing to{" "}
                {data.plans.find(
                  (plan) => plan.tier === entitlement.scheduledTier,
                )?.name ?? entitlement.scheduledTier}{" "}
                on {renewal.toLocaleDateString()}.
              </p>
            ) : renewal ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Renews {renewal.toLocaleDateString()}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                No subscription — the Free plan&rsquo;s credits are a one-time
                welcome grant.
              </p>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <p className="flex items-center gap-1.5 text-2xl font-semibold tabular-nums">
              <Coins className="size-5 text-muted-foreground" aria-hidden />
              {data.creditBalance.toLocaleString("en-US")}
            </p>
            <p className="text-2xs text-muted-foreground">credits available</p>

            <div className="flex gap-1.5">
              {entitlement.cancelAtPeriodEnd ? (
                <Button
                  size="xs"
                  variant="outline"
                  loading={busy && pendingTier === entitlement.tier}
                  onClick={() => void selectPlan(entitlement.tier)}
                >
                  <RotateCcw />
                  Resume
                </Button>
              ) : null}

              {entitlement.stripeCustomerId ? (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    void withBusy(async () => {
                      const { url } = await api.openPortal();
                      window.location.href = url;
                    }, "Could not open the billing portal")
                  }
                >
                  <CreditCard />
                  Manage payment
                  <ExternalLink className="size-3" />
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* Plans */}
      <section className="space-y-4" aria-labelledby="plans-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="plans-heading" className="text-sm font-medium">
            Plans
          </h2>
          {/* No interval selector.
              Annual billing was retired in Sprint 4 — it takes a year of money
              against provider costs that have not been measured — and no
              yearly Stripe price exists to check out against. A toggle whose
              second option resolves to no price is a button that fails after
              the click rather than before it. `interval` stays MONTH. */}
          <p className="text-xs text-muted-foreground">Billed monthly</p>
        </div>

        {/* Somebody who chose a plan on the pricing page arrives having already
            decided. Saying so beats making them find the card again — and it is
            a reminder, not an automatic checkout: starting a payment because of
            a query parameter would be starting one they never confirmed. */}
        {highlightTier && highlightTier !== entitlement.tier ? (
          <p className="rounded-lg border border-primary/30 bg-primary/[0.06] p-3 text-xs">
            You picked{" "}
            <span className="font-medium">
              {data.plans.find((plan) => plan.tier === highlightTier)?.name}
            </span>{" "}
            on the pricing page. Confirm below to continue.
          </p>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          {data.plans.map((plan) => (
            <PlanCard
              key={plan.tier}
              plan={plan}
              highlighted={plan.tier === highlightTier}
              interval={interval}
              currentTier={billingTier ?? entitlement.tier}
              scheduledTier={entitlement.scheduledTier}
              cancelAtPeriodEnd={entitlement.cancelAtPeriodEnd}
              disabled={!data.configured || busy}
              pending={pendingTier === plan.tier}
              onSelect={(tier) => void selectPlan(tier)}
            />
          ))}
        </div>
      </section>

      {/* Credit packs */}
      <section className="space-y-3" aria-labelledby="packs-heading">
        <div>
          <h2 id="packs-heading" className="text-sm font-medium">
            Top up
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            One-off credits that never expire. Useful when a deadline arrives
            before your renewal does.
          </p>
        </div>

        <ul className="grid gap-3 sm:grid-cols-3">
          {data.packs.map((pack) => (
            <li
              key={pack.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium tabular-nums">{pack.name}</p>
                {/* `amount` is already in minor units, so cents-per-credit is
                    a plain division. Multiplying by 100 as well quoted 120¢ for
                    a credit that costs 1.2¢ — the kind of arithmetic slip that
                    only looks wrong once somebody reads the number. */}
                <p className="text-2xs text-muted-foreground tabular-nums">
                  {formatMoney(pack.amount)} ·{" "}
                  {(pack.amount / pack.credits).toFixed(2)}¢ per credit
                </p>
              </div>
              <Button
                size="xs"
                variant="secondary"
                disabled={!data.configured || !pack.priceId || busy}
                loading={pendingPack === pack.id}
                title={
                  pack.priceId ? undefined : "No Stripe price is configured"
                }
                onClick={() =>
                  void (async () => {
                    setPendingPack(pack.id);
                    const result = await withBusy(
                      () => api.startPackCheckout(pack.id),
                      "Could not start checkout",
                    );
                    setPendingPack(null);
                    if (result) window.location.href = result.url;
                  })()
                }
              >
                <Plus />
                Buy
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <UsagePanel
        usage={usage}
        /**
         * The allowance follows the **billed** plan, not the access tier.
         *
         * Credits are granted by `invoice.paid` from the subscription's own
         * plan, so an owner on complimentary Studio with a Creator
         * subscription receives 500 a month, not Studio's 4,800. Showing the
         * access tier's figure here read "860 of 4,800 used" against an
         * allowance that will never arrive.
         */
        allowance={allowanceApplies ? grantingPlan!.monthlyCredits : null}
        allowanceNote={allowanceNote}
        balance={data.creditBalance}
      />

      {/* Invoices */}
      <section className="space-y-3" aria-labelledby="invoices-heading">
        <h2
          id="invoices-heading"
          className="flex items-center gap-2 text-sm font-medium"
        >
          <Receipt className="size-4 text-muted-foreground" aria-hidden />
          Invoices
        </h2>

        {data.invoices === null ? (
          // Distinct from "no invoices". Saying nothing would imply the latter.
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            Invoices could not be loaded from Stripe just now. Everything else
            on this page is up to date.
          </p>
        ) : data.invoices.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No invoices yet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.invoices.map((invoice) => (
              <li
                key={invoice.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs">
                      {invoice.number ?? invoice.id.slice(-8)}
                    </span>
                    <Badge
                      variant={
                        invoice.status === "paid"
                          ? "success"
                          : invoice.status === "open"
                            ? "warning"
                            : "outline"
                      }
                      size="sm"
                    >
                      {invoice.status}
                    </Badge>
                  </p>
                  <p className="text-2xs text-muted-foreground">
                    {new Date(invoice.created).toLocaleDateString()}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm tabular-nums">
                    {formatMoney(
                      invoice.amountPaid || invoice.amountDue,
                      invoice.currency,
                    )}
                  </span>
                  {invoice.hostedUrl ? (
                    <Button size="xs" variant="ghost" asChild>
                      <a
                        href={invoice.hostedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <FileText />
                        View
                      </a>
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Billing history — the credit ledger */}
      <section className="space-y-3" aria-labelledby="history-heading">
        <div>
          <h2 id="history-heading" className="text-sm font-medium">
            Billing history
          </h2>
          {/* Named as what it is. People expect receipts here; this is the
              ledger, which also covers everything that never touched a card. */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every change to your credit balance, including grants, spend and
            refunds.
          </p>
        </div>

        {data.history.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            Nothing yet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.history.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-medium">{describeReason(entry)}</p>
                  <p className="text-2xs text-muted-foreground">
                    {formatRelativeTime(entry.createdAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={
                      entry.amount > 0
                        ? "font-medium text-success tabular-nums"
                        : "font-medium tabular-nums"
                    }
                  >
                    {entry.amount > 0 ? "+" : ""}
                    {entry.amount.toLocaleString("en-US")}
                  </p>
                  <p className="text-2xs text-muted-foreground tabular-nums">
                    balance {entry.balanceAfter.toLocaleString("en-US")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming === "FREE"
                ? "Cancel your subscription?"
                : `Move to ${data.plans.find((plan) => plan.tier === confirming)?.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {renewal ? (
                <>
                  Nothing changes until{" "}
                  <strong className="font-medium text-foreground">
                    {renewal.toLocaleDateString()}
                  </strong>
                  . You keep your current plan and allowance for the period you
                  have already paid for, and credits you already hold are not
                  removed.
                </>
              ) : (
                "You keep everything you have already paid for."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current plan</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const tier = confirming;
                setConfirming(null);
                if (tier) void applyChange(tier);
              }}
            >
              {confirming === "FREE" ? "Cancel subscription" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function describeReason(entry: {
  reason: string;
  generation: { model: string; operation: string } | null;
}): string {
  switch (entry.reason) {
    case "SIGNUP_GRANT":
      return "Welcome credits";
    case "SUBSCRIPTION_GRANT":
      return "Plan allowance";
    case "PACK_PURCHASE":
      return "Credit pack";
    case "GENERATION_REFUND":
      return "Refund — generation failed";
    case "MANUAL_ADJUSTMENT":
      return "Adjustment";
    case "GENERATION_SPEND":
      return entry.generation
        ? `${entry.generation.operation.replace(/-/g, " ")} · ${entry.generation.model}`
        : "Generation";
    default:
      return entry.reason;
  }
}
