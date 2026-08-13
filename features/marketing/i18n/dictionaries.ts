import { EN } from "@/features/marketing/i18n/en";
import { ES } from "@/features/marketing/i18n/es";
import type { MarketingCopy } from "@/features/marketing/i18n/copy";
import type { Locale } from "@/features/marketing/i18n/locales";

/**
 * Locale to copy.
 *
 * Deliberately **not** in `index.tsx`, which is `"use client"`. Server
 * components in the marketing tree take `locale` as a prop and call this
 * directly; importing it from the client module would pull the provider — and
 * therefore React context — into a server render for no reason.
 */
const DICTIONARIES: Record<Locale, MarketingCopy> = { en: EN, es: ES };

export function getCopy(locale: Locale): MarketingCopy {
  return DICTIONARIES[locale];
}
