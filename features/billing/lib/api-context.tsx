"use client";

import { createContext, useContext, type ReactNode } from "react";

import * as api from "@/features/billing/lib/api";

/**
 * The billing client, injectable.
 *
 * Same seam as `features/projects/lib/api-context.tsx`, for the same reason and
 * with more force behind it: there is no Stripe account here, and billing is
 * the one surface where "it typechecked" is furthest from "it works". Money
 * moves, plans change, and every state — past due, cancelling, scheduled
 * downgrade, unconfigured — has to be looked at.
 *
 * The default value is the real module, so production behaviour is unchanged
 * and no call site passes anything. `/billing-preview` substitutes an in-memory
 * implementation and the same components become clickable.
 */

export interface BillingApi {
  loadBilling: typeof api.loadBilling;
  startSubscriptionCheckout: typeof api.startSubscriptionCheckout;
  startPackCheckout: typeof api.startPackCheckout;
  changePlan: typeof api.changePlan;
  cancelPlan: typeof api.cancelPlan;
  resumePlan: typeof api.resumePlan;
  openPortal: typeof api.openPortal;
}

const REAL: BillingApi = {
  loadBilling: api.loadBilling,
  startSubscriptionCheckout: api.startSubscriptionCheckout,
  startPackCheckout: api.startPackCheckout,
  changePlan: api.changePlan,
  cancelPlan: api.cancelPlan,
  resumePlan: api.resumePlan,
  openPortal: api.openPortal,
};

const BillingApiContext = createContext<BillingApi>(REAL);

export function useBillingApi(): BillingApi {
  return useContext(BillingApiContext);
}

export function BillingApiProvider({
  value,
  children,
}: {
  value: BillingApi;
  children: ReactNode;
}) {
  return (
    <BillingApiContext.Provider value={value}>
      {children}
    </BillingApiContext.Provider>
  );
}
