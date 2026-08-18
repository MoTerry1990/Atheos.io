/**
 * Create every Stripe product and price this app sells, from the catalogue.
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/setup-stripe.ts --dry-run
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/setup-stripe.ts
 *
 * ## Why this exists
 *
 * Eleven objects — four tiers × two intervals, plus three credit packs — each
 * needing a name, an amount, an interval and a currency typed into a dashboard,
 * then eleven ids copied back into the deployment environment. Done by hand
 * that is an afternoon and at least one transposed character, and a
 * transposed character means a customer is charged the wrong amount or the
 * checkout 500s. The catalogue already holds every number. This just tells
 * Stripe about them.
 *
 * ## Idempotent, by lookup key
 *
 * Every price gets `lookup_key` — `atheos_basic_month`, `atheos_pack_1000`.
 * Re-running finds the existing price and reports it rather than creating a
 * second one at the same amount, which is the failure that makes a Stripe
 * account impossible to reason about later.
 *
 * ## Prices are immutable in Stripe
 *
 * You cannot edit an amount. Changing a price means creating a new one and
 * moving the id over — which is exactly what this does on the next run if the
 * catalogue amount has changed, after archiving the old one. Existing
 * subscribers stay on the price they signed up to, which is both correct and
 * the law in most places.
 *
 * ## It prints, it does not deploy
 *
 * The output is the block of environment variables to paste into Vercel. This
 * script has no business writing to the production environment, and a human
 * reading eleven ids before they go live is a cheap last check.
 */

import Stripe from "stripe";

import {
  PACK_DEFINITIONS,
  PLAN_DEFINITIONS,
  CURRENCY,
} from "../services/billing/catalogue";

const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Reconcile only the subscription plans, leaving credit packs alone.
 *
 * Sprint 6A wanted exactly three products in the Stripe account — Creator, Pro
 * and Studio — and nothing else. The packs are a real part of the catalogue and
 * this script still creates them by default; the flag exists so a run scoped to
 * subscriptions cannot quietly add three more products to somebody's dashboard
 * as a side effect of setting up plans.
 */
const SUBSCRIPTIONS_ONLY = process.argv.includes("--subscriptions-only");

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error(
    "STRIPE_SECRET_KEY is not set.\n" +
      "Put it in .env.local — never paste it into a chat window — and re-run.",
  );
  process.exit(1);
}

if (key.startsWith("sk_live") && !process.argv.includes("--live")) {
  console.error(
    "That is a LIVE key. Re-run with --live if you mean it.\n" +
      "Products created in live mode charge real cards.",
  );
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });

/** What the deployment environment needs, accumulated as we go. */
const envLines: string[] = [];

/**
 * Find a price by lookup key, or make one.
 *
 * Returns the existing price untouched when the amount still matches. When it
 * does not, the old price is archived and a new one created — Stripe prices are
 * immutable, so this is the only way to change an amount, and archiving rather
 * than deleting keeps existing subscriptions working.
 */
async function ensurePrice(options: {
  lookupKey: string;
  productName: string;
  productDescription: string;
  amount: number;
  interval?: "month" | "year";
  envVar: string;
}): Promise<void> {
  const { lookupKey, amount, interval, envVar } = options;

  const existing = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });

  const found = existing.data[0];

  if (found && found.unit_amount === amount) {
    console.log(`  = ${lookupKey.padEnd(24)} ${found.id} (unchanged)`);
    envLines.push(`${envVar}=${found.id}`);
    return;
  }

  if (DRY_RUN) {
    const verb = found ? "REPRICE" : "CREATE";
    console.log(
      `  ${verb} ${lookupKey.padEnd(22)} ${(amount / 100).toFixed(2)} ${CURRENCY.toUpperCase()}${
        interval ? ` / ${interval}` : " one-off"
      }`,
    );
    envLines.push(`${envVar}=<created on a real run>`);
    return;
  }

  // Reuse the product when repricing, so the customer-facing name and the
  // reporting history stay attached to one object across price changes.
  const productId =
    found && typeof found.product === "string"
      ? found.product
      : (
          await stripe.products.create({
            name: options.productName,
            description: options.productDescription,
          })
        ).id;

  if (found) {
    // Free the lookup key before reusing it — Stripe allows it on exactly one
    // active price at a time.
    await stripe.prices.update(found.id, { lookup_key: "", active: false });
    console.log(`  ~ archived ${found.id} (amount changed)`);
  }

  const price = await stripe.prices.create({
    product: productId,
    currency: CURRENCY,
    unit_amount: amount,
    lookup_key: lookupKey,
    ...(interval ? { recurring: { interval } } : {}),
  });

  console.log(`  + ${lookupKey.padEnd(24)} ${price.id}`);
  envLines.push(`${envVar}=${price.id}`);
}

async function main() {
  console.log(
    `\n${DRY_RUN ? "DRY RUN — nothing will be created" : "Creating in Stripe"}` +
      ` (${key!.startsWith("sk_live") ? "LIVE" : "test"} mode)\n`,
  );

  console.log("Subscriptions");
  for (const plan of PLAN_DEFINITIONS) {
    // The free tier is the *absence* of a subscription, not a zero-amount one:
    // a $0 Stripe subscription still asks for a card, which is precisely the
    // friction a free tier exists to remove.
    if (plan.monthly === 0) {
      console.log(
        `  · ${plan.name.padEnd(22)} skipped — free tier has no price`,
      );
      continue;
    }

    const tier = plan.tier.toLowerCase();

    await ensurePrice({
      lookupKey: `atheos_${tier}_month`,
      productName: `Atheos ${plan.name}`,
      productDescription: plan.description,
      amount: plan.monthly,
      interval: "month",
      envVar: `STRIPE_PRICE_${plan.tier}_MONTHLY`,
    });

    // No yearly price. Sprint 4 retired annual billing: it takes a year of
    // money against provider costs that have not been measured, and the
    // correction for a mispriced annual plan is a year of refunds rather than
    // a better number next month.
  }

  console.log(
    SUBSCRIPTIONS_ONLY
      ? "\nCredit packs — skipped (--subscriptions-only)"
      : "\nCredit packs",
  );
  for (const pack of SUBSCRIPTIONS_ONLY ? [] : PACK_DEFINITIONS) {
    await ensurePrice({
      lookupKey: `atheos_${pack.id}`,
      productName: `Atheos — ${pack.name}`,
      productDescription: `${pack.credits.toLocaleString("en-US")} credits, one-off. They never expire.`,
      amount: pack.amount,
      envVar: `STRIPE_PRICE_${pack.id.toUpperCase()}`,
    });
  }

  console.log(
    "\n" +
      "─".repeat(64) +
      "\nPaste these into Vercel → Settings → Environment Variables (Production):\n",
  );
  console.log(envLines.join("\n"));
  console.log(
    "\nStill needed, and not creatable from here:\n" +
      "  STRIPE_WEBHOOK_SECRET — from the webhook endpoint you add in the\n" +
      "  dashboard, pointing at /api/webhooks/stripe. Without it a completed\n" +
      "  payment grants nothing, which is the worst of the failure modes\n" +
      "  because the card has already been charged.\n",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
