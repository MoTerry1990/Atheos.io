import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PLAN_DEFINITIONS,
  formatMoney,
  visiblePlanDefinitions,
} from "@/services/billing/catalogue";
import { PLAN_CONFIGS } from "@/services/billing/plan-config";
import { planDefinitionFor } from "@/services/billing/catalogue";
import { PRICING } from "@/features/marketing/content";
import { EN } from "@/features/marketing/i18n/en";
import { ES } from "@/features/marketing/i18n/es";

/**
 * The public pricing surface, pinned.
 *
 * The founder checked the deployed site and found it still advertising the old
 * plans. The cause was that nothing had been deployed — the branch was three
 * commits ahead of the remote — but the surface is worth pinning regardless,
 * because it is spread across a server catalogue, an entitlement table, a
 * marketing content module and two dictionaries, and a change to one of them
 * has repeatedly failed to reach the others.
 *
 * Sprint 4.1 found the sharpest example: the catalogue said Studio, the
 * dictionary the pricing card actually renders said **Agency**, and every test
 * passed.
 */

const DICTIONARIES = { en: EN, es: ES } as const;

describe("exactly four public plans", () => {
  it("names them Free, Creator, Pro and Studio", () => {
    expect(visiblePlanDefinitions().map((plan) => plan.name)).toEqual([
      "Free",
      "Creator",
      "Pro",
      "Studio",
    ]);
  });

  it("prices them $0, $9.99, $34.99 and $89.99", () => {
    // Minor units, because that is what Stripe takes and what the catalogue
    // stores. The formatted strings are asserted too — a card showing "$9.99"
    // is the thing a customer actually reads.
    expect(visiblePlanDefinitions().map((plan) => plan.monthly)).toEqual([
      0, 999, 3499, 8999,
    ]);

    expect(
      visiblePlanDefinitions().map((plan) => formatMoney(plan.monthly)),
    ).toEqual(["$0", "$9.99", "$34.99", "$89.99"]);
  });

  it("has no fifth plan anywhere in the stack", () => {
    // Catalogue, entitlement table and marketing cards must agree on the count.
    expect(visiblePlanDefinitions()).toHaveLength(4);
    expect(PLAN_CONFIGS).toHaveLength(4);
    expect(PRICING).toHaveLength(4);
    expect(PLAN_DEFINITIONS).toHaveLength(4);
  });

  it("contains no Starter and no Agency", () => {
    const names = [
      ...PLAN_DEFINITIONS.map((p) => p.name),
      ...PLAN_CONFIGS.map((p) => p.displayName),
      ...Object.values(DICTIONARIES).flatMap((copy) =>
        Object.values(copy.plans).map((plan) => plan.name),
      ),
    ];

    for (const name of names) {
      expect(name).not.toMatch(/agency/i);
      expect(name).not.toMatch(/^starter/i);
    }
  });

  it("keeps the tier identifier and the public name the same word", () => {
    for (const plan of PLAN_CONFIGS) {
      expect(plan.tier).toBe(plan.displayName.toUpperCase());
    }
  });
});

describe("monthly billing only", () => {
  it("carries no yearly price on any plan", () => {
    for (const plan of PLAN_DEFINITIONS) {
      expect(Object.keys(plan)).not.toContain("yearly");
    }
    for (const tier of PRICING) {
      expect(Object.keys(tier)).not.toContain("yearly");
      expect(Object.keys(tier)).not.toContain("yearlyTotal");
    }
  });

  it("offers no annual selector in either dictionary", () => {
    // The toggle's labels and its saving copy are gone from the contract, so a
    // selector cannot be rebuilt without re-adding them here first.
    for (const copy of Object.values(DICTIONARIES)) {
      const keys = Object.keys(copy.pricing);
      for (const gone of ["yearly", "yearlySave", "billedYearly", "save"]) {
        expect(keys).not.toContain(gone);
      }
    }
  });

  it("mints no yearly price id, even in the dev fixture", () => {
    /**
     * The billing preview builds its own fake price ids. It was still minting
     * `price_fixture_{TIER}_y` alongside the monthly one, which made the
     * preview render a working yearly option — for a price that does not exist
     * in Stripe, on a plan that is not sold annually. A preview showing
     * something the real screen cannot do is worse than no preview.
     */
    const source = readFileSync(
      resolve(
        import.meta.dirname,
        "../../app/(dev)/billing-preview/fixtures.ts",
      ),
      "utf8",
    );

    expect(source.length, "the fixture is empty or unreadable").toBeGreaterThan(
      500,
    );
    expect(source, "the fixture still mints a yearly price id").not.toMatch(
      /year:\s*`price_fixture/,
    );
  });

  it("renders no interval toggle on the pricing page or in billing settings", () => {
    // Source-level, because both were React state that no unit test reaches.
    // Each path is resolved and the file length checked, so a moved or renamed
    // file fails loudly rather than passing on an empty read.
    for (const file of [
      "features/marketing/components/pricing.tsx",
      "features/billing/components/billing-screen.tsx",
    ]) {
      const source = readFileSync(
        resolve(import.meta.dirname, "../..", file),
        "utf8",
      );

      expect(source.length, `${file} is empty or unreadable`).toBeGreaterThan(
        500,
      );
      expect(source, `${file} still renders a yearly control`).not.toMatch(
        /ToggleGroupItem value="YEAR"|setYearly|Billing period/,
      );
    }
  });
});

describe("credit claims", () => {
  it("never says the Free plan renews monthly", () => {
    for (const [locale, copy] of Object.entries(DICTIONARIES)) {
      const free = copy.plans.FREE;
      const text = [free.description, ...free.features].join(" ");

      // "one time" / "por única vez" is required; monthly is forbidden.
      expect(text, `${locale} free plan copy`).toMatch(
        locale === "en" ? /one[- ]time/i : /única vez/i,
      );
      expect(text).not.toMatch(
        locale === "en" ? /credits? (a|per) month|monthly/i : /al mes/i,
      );
    }
  });

  it("never quotes a monthly credit figure in the composer or the FAQ", () => {
    // "Free to start — 100 credits a month" sat under the hero composer and in
    // the FAQ, contradicting the one-time grant on the card directly below.
    for (const copy of Object.values(DICTIONARIES)) {
      const blobs = [
        copy.composer.note,
        copy.composer.noteEmpty,
        ...copy.faq.map((entry) => entry.answer),
      ];

      for (const text of blobs) {
        expect(text).not.toMatch(/\d+\s*credits? a month/i);
        expect(text).not.toMatch(/\d+\s*créditos al mes/i);
      }
    }
  });

  it("advertises no credit allowance for a plan the backend has not settled", () => {
    /**
     * The rule was never "paid plans show no number" — it was "never advertise
     * a number the backend cannot honour". Until Sprint 6A the paid allowances
     * were genuinely unsettled, so the only safe display was none.
     *
     * They are settled now, so the invariant asserts what it always meant: a
     * card shows a figure exactly when the catalogue has one, and stays silent
     * when it does not.
     */
    for (const tier of PRICING) {
      const settled = planDefinitionFor(tier.tier).monthlyCredits;

      if (settled === null) {
        expect(
          tier.credits,
          `${tier.tier} advertises an unsettled allowance`,
        ).toBeNull();
      } else {
        expect(
          tier.credits,
          `${tier.tier} hides a settled allowance`,
        ).not.toBeNull();
      }
    }
  });

  it("quotes no generation counts that were never cost-verified", () => {
    // "11 videos or 250 images a month" was on three cards. Those numbers came
    // from dividing a guessed allowance by a guessed unit price.
    for (const copy of Object.values(DICTIONARIES)) {
      for (const plan of Object.values(copy.plans)) {
        for (const feature of plan.features) {
          expect(feature).not.toMatch(/\d+\s*(videos?|images?)\b/i);
          expect(feature).not.toMatch(/\d+\s*(videos?|imágenes)\b/i);
        }
      }
    }
  });

  it("uses no unlimited language anywhere public", () => {
    const everything = Object.values(DICTIONARIES).flatMap((copy) =>
      JSON.stringify(copy).split(","),
    );

    for (const chunk of everything) {
      expect(chunk).not.toMatch(/\bunlimited\b/i);
      expect(chunk).not.toMatch(/\bilimitad/i);
    }
  });
});

describe("paid CTAs do not imply working checkout", () => {
  it("labels every unsellable plan as coming soon", () => {
    // Stripe is not configured. A button reading "Choose Pro" promises a
    // checkout that cannot start.
    for (const copy of Object.values(DICTIONARIES)) {
      expect(copy.pricing.ctaPending.length).toBeGreaterThan(0);
      expect(copy.pricing.ctaPending).not.toMatch(/choose|elegir/i);
    }

    // And every paid plan is in the state that uses it.
    for (const tier of PRICING) {
      if (tier.monthly > 0) expect(tier.status).toBe("launch_disabled");
    }
  });
});
