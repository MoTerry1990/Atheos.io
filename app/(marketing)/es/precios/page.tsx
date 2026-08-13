import type { Metadata } from "next";

import { MarketingShell } from "@/features/marketing/components/marketing-shell";
import { PricingPage } from "@/features/marketing/components/pricing-page";
import { alternatesFor } from "@/features/marketing/i18n/metadata";

/**
 * `/es/precios`, not `/es/pricing`.
 *
 * The path is translated because the word is what somebody types. A Spanish
 * page behind an English URL still ranks for the English word, which is not
 * the query this page is for.
 */
export const metadata: Metadata = {
  title: "Precios",
  description:
    "Un solo saldo de créditos para todos los modelos. Empiece gratis, sin suscripciones por proveedor, y los créditos no usados se acumulan durante un mes.",
  alternates: alternatesFor("pricing", "es"),
  openGraph: { locale: "es_419" },
};

export default function Page() {
  return (
    <MarketingShell locale="es">
      <PricingPage locale="es" />
    </MarketingShell>
  );
}
