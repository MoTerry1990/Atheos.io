import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UsagePanel } from "@/features/billing/components/usage-panel";
import type { UsageReport } from "@/features/billing/lib/api";

/**
 * What the usage panel actually renders.
 *
 * ## Why this is a render test and not a source assertion
 *
 * The billing preview is a `(dev)` route, excluded from the production build —
 * requesting it there returns 404. So the one screen that shows this panel
 * cannot be opened in a production-like environment, and checking it in the dev
 * server means trusting a Turbopack module cache that has already served stale
 * output during this work.
 *
 * Rendering the component directly removes both problems: no server, no cache,
 * no route. What is asserted here is the text a customer reads.
 *
 * ## The defect being pinned
 *
 * An owner with complimentary Studio access and a paid Creator subscription saw
 * **"860 of 4,800 credits used"** — Studio's allowance, which complimentary
 * access never grants. Credits come from `invoice.paid` on the *billed* plan,
 * which is 500 a month.
 *
 * The deeper confusion was what the two numbers mean. `creditsSpent` is net
 * ledger consumption across every credit source — signup grant, packs,
 * subscription grants, adjustments — drawn from one pooled balance. The
 * allowance is only a reference point, and spending past it is normal.
 */

const usage: UsageReport = {
  periodStart: Date.UTC(2026, 7, 9),
  periodEnd: Date.UTC(2026, 8, 8),
  isBillingPeriod: true,
  creditsSpent: 860,
  creditsGranted: 500,
  generations: 47,
  byModality: [{ modality: "IMAGE", credits: 860, generations: 47 }],
  byModel: [{ model: "replicate/flux-schnell", credits: 860, generations: 47 }],
};

describe("the owner case that was wrong in production", () => {
  it("shows the billed plan's grant, never the complimentary tier's", () => {
    render(
      <UsagePanel
        usage={usage}
        allowance={500}
        allowanceNote="Creator grants 500 credits monthly"
        balance={17_079}
      />,
    );

    expect(screen.getByText(/of 500 used this billing period/)).toBeTruthy();
    // The number that must never appear: Studio's allowance, which
    // complimentary access does not grant.
    expect(screen.queryByText(/4,800/)).toBeNull();
  });

  it("attributes the denominator to a named plan", () => {
    render(
      <UsagePanel
        usage={usage}
        allowance={500}
        allowanceNote="Creator grants 500 credits monthly"
        balance={17_079}
      />,
    );
    // "of 500" with no stated origin is the ambiguity that let the wrong
    // plan's figure sit there unnoticed.
    expect(screen.getByText("Creator grants 500 credits monthly")).toBeTruthy();
  });

  it("shows the wallet balance, which is not the allowance", () => {
    render(
      <UsagePanel
        usage={usage}
        allowance={500}
        allowanceNote="Creator grants 500 credits monthly"
        balance={17_079}
      />,
    );
    expect(screen.getByText(/17,079 balance/)).toBeTruthy();
  });

  it("explains that spending past the grant is normal", () => {
    // 860 spent against a 500 grant. Not an overage — generations draw on the
    // whole pooled balance.
    render(
      <UsagePanel
        usage={usage}
        allowance={500}
        allowanceNote="Creator grants 500 credits monthly"
        balance={17_079}
      />,
    );
    expect(screen.getByText(/draw on your whole balance/)).toBeTruthy();
  });

  it("explains a balance larger than the grant", () => {
    render(
      <UsagePanel
        usage={usage}
        allowance={500}
        allowanceNote="Creator grants 500 credits monthly"
        balance={17_079}
      />,
    );
    expect(screen.getByText(/credits never expire/)).toBeTruthy();
  });
});

describe("an owner billed for nothing", () => {
  it("invents no denominator and says complimentary access grants none", () => {
    render(
      <UsagePanel
        usage={usage}
        allowance={null}
        allowanceNote="Complimentary access grants no credits — spending draws on your balance"
        balance={17_079}
      />,
    );

    expect(screen.getByText("Available balance")).toBeTruthy();
    expect(screen.getByText("Credits spent in this window")).toBeTruthy();
    expect(screen.queryByText(/used this billing period/)).toBeNull();
    expect(
      screen.getByText(/Complimentary access grants no credits/),
    ).toBeTruthy();
  });
});

describe("an ordinary subscriber", () => {
  it("shows their own plan's grant with no confusing extras", () => {
    render(
      <UsagePanel
        usage={{ ...usage, creditsSpent: 380 }}
        allowance={500}
        allowanceNote="Creator grants 500 credits monthly"
        balance={620}
      />,
    );

    expect(screen.getByText(/380/)).toBeTruthy();
    expect(screen.getByText(/of 500 used this billing period/)).toBeTruthy();
    // Under the grant and under the balance: neither explainer applies.
    expect(screen.queryByText(/spent more than this period/)).toBeNull();
  });
});

describe("the denominator only exists for a real billing period", () => {
  /**
   * `creditsSpent` is period-scoped, not lifetime — `usagePeriodFor` returns
   * the subscription's billing period and `getUsage` filters `createdAt` to it,
   * netting GENERATION_REFUND against GENERATION_SPEND. That is what makes
   * "of 500 used this billing period" a true statement rather than a
   * comparison between a rolling window and a monthly grant.
   *
   * When the window is the trailing-30-day fallback, or the grant is one-time,
   * or nothing grants at all, the caller passes a null allowance and the bar
   * disappears. These assert the panel honours that rather than inventing one.
   */
  it("states separate facts when there is no billing-period metric", () => {
    render(
      <UsagePanel
        usage={{ ...usage, isBillingPeriod: false, creditsSpent: 12_500 }}
        allowance={null}
        allowanceNote={null}
        balance={17_079}
      />,
    );

    expect(screen.getByText("Available balance")).toBeTruthy();
    expect(screen.getByText("17,079 credits")).toBeTruthy();
    expect(screen.getByText("Credits spent in this window")).toBeTruthy();
    expect(screen.getByText("12,500")).toBeTruthy();

    // The claim that must not be made: pooled spend measured against a plan.
    expect(screen.queryByText(/used this billing period/)).toBeNull();
    expect(screen.queryByText(/of 500/)).toBeNull();
    expect(screen.queryByText(/of 100/)).toBeNull();
  });

  it("renders no progress bar without a denominator", () => {
    // A bar is a claim that something finite is being consumed. Credits pool
    // and never expire, so with no billing-period grant there is nothing to
    // draw a fraction of.
    const { container } = render(
      <UsagePanel
        usage={{ ...usage, isBillingPeriod: false }}
        allowance={null}
        allowanceNote={null}
        balance={17_079}
      />,
    );
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("labels the bar as the billing period when one exists", () => {
    render(
      <UsagePanel
        usage={usage}
        allowance={500}
        allowanceNote="Creator grants 500 credits monthly"
        balance={17_079}
      />,
    );
    // Not "this period" — the billing period specifically, which is the only
    // window the 500 belongs to.
    expect(screen.getByText(/used this billing period/)).toBeTruthy();
  });
});
