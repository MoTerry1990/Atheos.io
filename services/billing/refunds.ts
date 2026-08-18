import "server-only";

/**
 * What a refund or a dispute does to a subscriber's credits and access.
 *
 * ## Why the decision is a pure function
 *
 * Because `planReversal` had to be extracted for exactly this reason one sprint
 * ago. The generation-refund policy was wrong in production for a fortnight
 * while its tests stayed green, because those tests re-expressed the rules in
 * SQL fixtures instead of calling the code. A re-implementation cannot disagree
 * with the implementation, so it cannot catch it being wrong.
 *
 * Everything below is arithmetic over five numbers. It touches no database, so
 * every branch — including the ones that are awkward to reach through Stripe —
 * is directly testable.
 *
 * ## The policy
 *
 * A refund returns the customer's money, so it ends the thing the money bought:
 * paid entitlement stops immediately. The credits are harder, and the rules are
 * deliberately asymmetric.
 *
 *   - **Only** credits granted by the refunded invoice are removed. A signup
 *     grant, a credit pack and last month's subscription grant were paid for
 *     separately and are untouched.
 *   - The clawback is **capped at the current balance**. A balance may never go
 *     negative: an account in credit debt cannot generate, cannot be explained
 *     to the customer, and is not a state any of the ledger's invariants expect.
 *   - Credits already **spent** cannot be recovered — the work was delivered and
 *     the provider was paid. That shortfall is recorded as a loss and the
 *     account is flagged, rather than silently absorbed or clawed back from
 *     unrelated purchases.
 *
 * A **partial** refund is never automated. Deciding what fraction of an
 * allowance a partial refund entitles the customer to keep is a judgement about
 * proportionality that is not deterministic from the amounts alone — so it is
 * flagged for a human instead of guessed at.
 *
 * A **dispute** is not a refund: the money has not moved yet, the bank decides
 * later, and the account is more likely to be fraudulent. Access stops at once
 * and the account is flagged; no credit arithmetic happens, because reversing
 * credits on a dispute that is later resolved in the customer's favour would
 * punish someone who did nothing wrong.
 */

export type RefundPlan =
  /** A reversal for this charge already exists. Nothing to do. */
  | { action: "already" }
  /** Not deterministic enough to automate. A human decides. */
  | { action: "manual_review"; reason: string }
  /** End entitlement and remove what is left of the refunded allowance. */
  | {
      action: "revoke";
      /** Credits to remove now. Never exceeds the current balance. */
      clawback: number;
      /**
       * Granted credits that were already spent and cannot be recovered.
       * Non-zero means a real loss and a flagged account.
       */
      unrecoverable: number;
      flagForReview: boolean;
    };

export function planRefund(input: {
  /** Minor units refunded by this event. */
  refundedMinorUnits: number;
  /** Minor units the invoice originally charged. */
  invoiceMinorUnits: number;
  /** Credits granted by the refunded invoice. Zero if none were. */
  grantedCredits: number;
  /** The user's balance right now. */
  currentBalance: number;
  /** True when this charge has already been reversed. */
  alreadyReversed: boolean;
}): RefundPlan {
  if (input.alreadyReversed) return { action: "already" };

  if (input.invoiceMinorUnits <= 0) {
    return {
      action: "manual_review",
      reason:
        "the invoice amount is unknown, so the refund cannot be classified",
    };
  }

  if (input.refundedMinorUnits <= 0) {
    return {
      action: "manual_review",
      reason: "the refunded amount is not positive",
    };
  }

  // Strictly less than the invoice: a partial refund. Never automated.
  if (input.refundedMinorUnits < input.invoiceMinorUnits) {
    return {
      action: "manual_review",
      reason: "partial refunds are not settled automatically",
    };
  }

  /**
   * A refund larger than the invoice is not a bigger refund; it is a sign the
   * charge and the invoice do not belong together. Guessing would be worse than
   * stopping.
   */
  if (input.refundedMinorUnits > input.invoiceMinorUnits) {
    return {
      action: "manual_review",
      reason: "the refund exceeds the invoice, so the charge may not match it",
    };
  }

  const granted = Math.max(0, input.grantedCredits);
  const balance = Math.max(0, input.currentBalance);

  // The cap is the whole safety property: remove what is left, never more.
  const clawback = Math.min(granted, balance);
  const unrecoverable = granted - clawback;

  return {
    action: "revoke",
    clawback,
    unrecoverable,
    // A shortfall means the customer kept work they no longer paid for. That
    // is a business decision, not an automatic one.
    flagForReview: unrecoverable > 0,
  };
}

/** A dispute never touches credits — only access. */
export interface DisputePlan {
  suspendEntitlement: true;
  flagForReview: true;
}

export function planDispute(): DisputePlan {
  return { suspendEntitlement: true, flagForReview: true };
}
