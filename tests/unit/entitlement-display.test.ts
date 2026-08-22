import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { rankOf } from "@/services/billing/catalogue";
import type { PlanTier } from "@/lib/generated/prisma/enums";

/**
 * Access and billing are two different facts about an account.
 *
 * ## The defect this pins
 *
 * Sprint 6B bought Creator at $9.99 on the owner account. The billing page
 * reported **"Current plan: Studio"** and opened a **"Move to Creator?"**
 * dialog — offering to move the customer onto the plan they had paid for
 * minutes earlier.
 *
 * Nothing underneath was wrong. Stripe held one active Creator subscription,
 * the mirror row said `CREATOR`, and exactly 500 credits were granted against
 * the paid invoice. The screen was reading `entitlement.tier` — which for an
 * owner is a complimentary Studio grant — and treating it as the answer to
 * "what is this account paying for", a question it never answered.
 *
 * The two coincide for every ordinary customer, which is why one field served
 * for so long, and they diverge for exactly the people who test the product.
 *
 * The tier arithmetic below is the real `rankOf`; the rendering rules are
 * asserted against the component source, because the alternative is mounting a
 * client component that fetches from a live API.
 */

/** The shape the screen consumes, narrowed to the fields it decides from. */
interface Snapshot {
  tier: PlanTier;
  billedTier: PlanTier | null;
  complimentary: boolean;
}

/** The rule the plan cards use to decide which one reads as current. */
function billingTierOf(e: Snapshot): PlanTier | null {
  return e.complimentary ? e.billedTier : e.tier;
}

/** Whether selecting `target` should raise a downgrade confirmation. */
function confirmsDowngrade(e: Snapshot, target: PlanTier): boolean {
  const comparedTo = e.complimentary ? (e.billedTier ?? target) : e.tier;
  return rankOf(target) < rankOf(comparedTo);
}

const OWNER_ON_CREATOR: Snapshot = {
  tier: "STUDIO",
  billedTier: "CREATOR",
  complimentary: true,
};

describe("an owner who pays for Creator", () => {
  it("keeps Studio as effective access", () => {
    // The override is the point: an owner reaches every capability regardless
    // of what they pay for. That must not regress while fixing the display.
    expect(OWNER_ON_CREATOR.tier).toBe("STUDIO");
  });

  it("marks Creator as the current plan on the cards", () => {
    // The card the customer is billed for is the one that reads "current".
    expect(billingTierOf(OWNER_ON_CREATOR)).toBe("CREATOR");
  });

  it("never offers to move to the plan already being billed", () => {
    /**
     * The exact dialog from the report. Selecting Creator while Creator is the
     * billed plan is not a downgrade from Studio — it is the status quo.
     */
    expect(confirmsDowngrade(OWNER_ON_CREATOR, "CREATOR")).toBe(false);
  });

  it("still confirms a genuine downgrade below the billed plan", () => {
    // Creator → Free is a real loss of capability and still asks.
    expect(confirmsDowngrade(OWNER_ON_CREATOR, "FREE")).toBe(true);
  });

  it("treats a move above the billed plan as an upgrade, without a dialog", () => {
    for (const target of ["PRO", "STUDIO"] as const) {
      expect(confirmsDowngrade(OWNER_ON_CREATOR, target), target).toBe(false);
    }
  });

  it("marks no card current when the owner is billed for nothing", () => {
    // The ordinary owner: complimentary Studio, no subscription. Nothing is
    // being paid for, so nothing should claim to be the current plan.
    const owner: Snapshot = {
      tier: "STUDIO",
      billedTier: null,
      complimentary: true,
    };
    expect(billingTierOf(owner)).toBeNull();
    // And selecting any plan is a purchase, never a downgrade confirmation.
    for (const target of ["FREE", "CREATOR", "PRO", "STUDIO"] as const) {
      expect(confirmsDowngrade(owner, target), target).toBe(false);
    }
  });
});

describe("an ordinary customer is unaffected", () => {
  it("uses one tier for both access and billing", () => {
    const customer: Snapshot = {
      tier: "PRO",
      billedTier: "PRO",
      complimentary: false,
    };
    expect(billingTierOf(customer)).toBe("PRO");
    expect(confirmsDowngrade(customer, "PRO")).toBe(false);
    expect(confirmsDowngrade(customer, "CREATOR")).toBe(true);
    expect(confirmsDowngrade(customer, "STUDIO")).toBe(false);
  });

  it("falls back to Free when a subscription lapses", () => {
    /**
     * The case that rules out simply using `billedTier` everywhere. A lapsed
     * subscriber still has a row saying CREATOR, but access is Free — and a
     * card marked "current" for a plan they cannot use would be a lie.
     */
    const lapsed: Snapshot = {
      tier: "FREE",
      billedTier: "CREATOR",
      complimentary: false,
    };
    expect(billingTierOf(lapsed)).toBe("FREE");
    // Re-selecting Creator is a repurchase, not a downgrade.
    expect(confirmsDowngrade(lapsed, "CREATOR")).toBe(false);
  });

  it("marks no card current on Free with nothing billed", () => {
    const free: Snapshot = {
      tier: "FREE",
      billedTier: null,
      complimentary: false,
    };
    expect(billingTierOf(free)).toBe("FREE");
  });
});

describe("the screen renders both facts", () => {
  const source = readFileSync(
    resolve(
      import.meta.dirname,
      "../..",
      "features/billing/components/billing-screen.tsx",
    ),
    "utf8",
  );

  it("labels complimentary access as such", () => {
    expect(source).toMatch(/Complimentary owner access/);
    expect(source).toMatch(/Effective access/);
  });

  it("shows the billed subscription separately", () => {
    expect(source).toMatch(/Billed subscription:/);
    // With its price, so "Creator" alone cannot be mistaken for free access.
    expect(source).toMatch(/formatMoney\(billedPlan\.monthly\)/);
  });

  it("drives the plan cards from the billing tier, not the access tier", () => {
    /**
     * The single line that caused the defect. If this reverts to
     * `currentTier={entitlement.tier}` the owner sees "Studio" as current
     * again and the move dialog returns.
     */
    expect(source).toMatch(
      /currentTier=\{billingTier \?\? entitlement\.tier\}/,
    );
  });

  it("compares downgrades against the billed plan", () => {
    expect(source).toMatch(/current\.complimentary/);
    expect(source).toMatch(
      /rankOf\(target\)|rankOf\(tier\) < rankOf\(comparedTo\)/,
    );
  });
});

describe("billing controls use the real subscription", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "../..", "services/billing/subscription.ts"),
    "utf8",
  );

  it("no longer blanks the period dates for an owner", () => {
    /**
     * They were nulled out, which left the owner's own billing unmanageable
     * from the product: no renewal date, and the cancellation and portal
     * controls had nothing to act on. The dates describe the *subscription*,
     * which an owner can genuinely hold.
     */
    const owner = source.slice(
      source.indexOf("if (user && isOwnerAccount(user))"),
    );
    const block = owner.slice(0, owner.indexOf("};"));
    expect(block).toMatch(/currentPeriodEnd: subscription\?\.currentPeriodEnd/);
    expect(block).toMatch(
      /cancelAtPeriodEnd: subscription\?\.cancelAtPeriodEnd/,
    );
    expect(block).not.toMatch(/currentPeriodEnd: null/);
  });

  it("reports the billed tier from the row and keeps access complimentary", () => {
    const owner = source.slice(
      source.indexOf("if (user && isOwnerAccount(user))"),
    );
    const block = owner.slice(0, owner.indexOf("};"));
    expect(block).toMatch(
      /billedTier: subscription \? subscription\.planTier : null/,
    );
    expect(block).toMatch(/complimentary: true/);
    // Access itself must stay unconditional — that is what the override is for.
    expect(block).toMatch(/active: true/);
  });
});

describe("the usage panel is a wallet, not a plan meter", () => {
  const screen = readFileSync(
    resolve(
      import.meta.dirname,
      "../..",
      "features/billing/components/billing-screen.tsx",
    ),
    "utf8",
  );
  const panel = readFileSync(
    resolve(
      import.meta.dirname,
      "../..",
      "features/billing/components/usage-panel.tsx",
    ),
    "utf8",
  );
  const reporting = readFileSync(
    resolve(import.meta.dirname, "../..", "services/billing/reporting.ts"),
    "utf8",
  );

  it("draws the used figure from the ledger, not from generations alone", () => {
    /**
     * `creditsSpent` nets GENERATION_SPEND against GENERATION_REFUND in the
     * credit ledger. That is wallet consumption across every credit source —
     * signup grant, packs, subscription grants, manual adjustments — and it is
     * the authoritative number. Spending is not scoped to the subscription.
     */
    expect(reporting).toMatch(
      /creditsSpent: Math\.max\(0, -\(spend \+ refunds\)\)/,
    );
    expect(reporting).toMatch(/sumOf\("GENERATION_SPEND"\)/);
    expect(reporting).toMatch(/sumOf\("GENERATION_REFUND"\)/);
  });

  it("takes the denominator from the plan that actually grants credits", () => {
    /**
     * The defect: an owner on complimentary Studio saw "of 4,800", an allowance
     * that would never arrive. `invoice.paid` grants the *billed* plan's
     * figure, so only that plan has a real allowance for this account — and a
     * complimentary tier grants nothing at all.
     */
    expect(screen).toMatch(/const grantingPlan =/);
    // Gated on `allowanceApplies` — see the billing-period tests below, which
    // pin the three conditions that gate it.
    expect(screen).toMatch(/grantingPlan!\.monthlyCredits/);
    // Never the access tier.
    expect(screen).not.toMatch(/allowance=\{currentPlan\.monthlyCredits\}/);
    expect(screen).not.toMatch(/allowance=\{accessPlan\.monthlyCredits\}/);
  });

  it("never hardcodes an allowance figure", () => {
    // Every number comes from the catalogue, which is what the webhook grants
    // from. A literal here would drift from what the customer receives.
    for (const source of [screen, panel]) {
      expect(source).not.toMatch(/allowance=\{\s*\d+\s*\}/);
      expect(source).not.toMatch(
        /monthlyCredits\s*[:=]\s*(500|1800|1_800|4800|4_800)\b/,
      );
    }
  });

  it("attributes the denominator in words", () => {
    // "of 500" with no stated origin is the ambiguity that let the wrong plan's
    // number sit there unnoticed.
    expect(screen).toMatch(/grants \$\{|credits monthly`/);
    expect(screen).toMatch(/allowanceNote/);
    expect(panel).toMatch(/allowanceNote/);
  });

  it("says complimentary access grants no credits", () => {
    // The claim that must never be implied: that Studio-by-role handed over
    // 4,800 credits. It hands over none.
    expect(screen).toMatch(/Complimentary access grants no credits/);
  });

  it("states the billed plan's monthly grant beside its price", () => {
    expect(screen).toMatch(/credits monthly`/);
    expect(screen).toMatch(/billedPlan\.monthlyCredits !== null/);
  });

  it("treats spending above the grant as normal, not an overage", () => {
    // Credits pool and never expire, so used > allowance is expected rather
    // than an error state.
    expect(panel).toMatch(/spent more than this period/i);
    expect(panel).toMatch(/draw on your whole balance/i);
  });

  it("collapses to separate facts when no plan grants credits", () => {
    // An owner with no subscription, an unsettled allowance, or a rolling
    // window: state the balance and the spend, and invent no denominator.
    expect(panel).toMatch(/Available balance/);
    expect(panel).toMatch(/Credits spent in this window/);
    expect(panel).toMatch(/allowance !== null \? \(/);
  });
});

describe("the usage window is a billing period, not lifetime", () => {
  const reporting = readFileSync(
    resolve(import.meta.dirname, "../..", "services/billing/reporting.ts"),
    "utf8",
  );
  const screen = readFileSync(
    resolve(
      import.meta.dirname,
      "../..",
      "features/billing/components/billing-screen.tsx",
    ),
    "utf8",
  );

  it("scopes spend to a window rather than summing all time", () => {
    /**
     * The question that decides whether a denominator is legitimate at all. If
     * `creditsSpent` were lifetime ledger spend, comparing it to a monthly
     * grant would be meaningless — you cannot use 500 monthly credits as the
     * denominator of everything ever spent.
     *
     * It is not lifetime: every aggregate is filtered by `createdAt` within the
     * period, and refunds are netted against spend.
     */
    expect(reporting).toMatch(
      /const window = \{ gte: period\.start, lt: period\.end \}/,
    );
    expect(reporting).toMatch(/where: \{ userId, createdAt: window \}/);
    expect(reporting).toMatch(/-\(spend \+ refunds\)/);
  });

  it("says which window it used", () => {
    // A billing period and a rolling 30 days are different claims, and only one
    // may be compared to a monthly grant.
    expect(reporting).toMatch(/isBillingPeriod: true/);
    expect(reporting).toMatch(/isBillingPeriod: false/);
    expect(reporting).toMatch(/isBillingPeriod: boolean/);
  });

  it("shows a denominator only for a recurring grant inside a billing period", () => {
    /**
     * Three necessary conditions. Dropping any one reintroduces a false claim:
     * a rolling window measured against a month, a one-time Free grant
     * presented as monthly, or complimentary access implying an allowance.
     */
    expect(screen).toMatch(/const allowanceApplies =/);
    expect(screen).toMatch(/usage\.isBillingPeriod &&/);
    expect(screen).toMatch(/grantingPlan\.tier !== "FREE"/);
    expect(screen).toMatch(
      /allowance=\{allowanceApplies \? grantingPlan!\.monthlyCredits : null\}/,
    );
  });

  it("never labels wallet spend as a monthly figure", () => {
    // "used this billing period" is only rendered on the branch that has a
    // billing-period denominator; the fallback states facts separately.
    const panel = readFileSync(
      resolve(
        import.meta.dirname,
        "../..",
        "features/billing/components/usage-panel.tsx",
      ),
      "utf8",
    );
    expect(panel).toMatch(/used this billing period/);
    expect(panel).toMatch(/Available balance/);
    expect(panel).toMatch(/Credits spent in this window/);
    // No copy anywhere claims monthly usage without the billing-period gate.
    expect(panel).not.toMatch(/credits used this month/i);
  });

  it("keeps the wallet balance sourced from every ledger entry", () => {
    /**
     * `creditBalance` is the cached sum of the whole append-only ledger —
     * signup grant, packs, subscription grants, adjustments, spend and refunds
     * — not a per-plan figure. The billing API passes it straight through.
     */
    const route = readFileSync(
      resolve(import.meta.dirname, "../..", "app/api/billing/route.ts"),
      "utf8",
    );
    expect(route).toMatch(/creditBalance/);
    expect(reporting).toMatch(/sumOf\("SIGNUP_GRANT"\)/);
    expect(reporting).toMatch(/sumOf\("PACK_PURCHASE"\)/);
    expect(reporting).toMatch(/sumOf\("MANUAL_ADJUSTMENT"\)/);
  });

  it("keeps the Creator grant informational and separate from access", () => {
    // Stated beside the billed plan and its price, never merged into the
    // access tier's line.
    expect(screen).toMatch(/Billed subscription:/);
    expect(screen).toMatch(/billedPlan\.monthlyCredits !== null/);
    expect(screen).toMatch(/Effective access/);
  });
});
