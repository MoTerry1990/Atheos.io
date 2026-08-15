import { Sparkles } from "lucide-react";
import Link from "next/link";

import { SITE } from "@/features/marketing/content";
import { cn } from "@/lib/utils";

/**
 * The Atheos wordmark, as a link home.
 *
 * ## Why this is one component
 *
 * It was four. The marketing header, the dashboard shell, the community header
 * and the auth screen each rendered their own copy of a gradient square, a
 * `Sparkles` icon and `SITE.name` — and each picked its own destination:
 *
 *   marketing   `/` or `/es`   correct
 *   dashboard   `/dashboard`   a link from the dashboard to the dashboard
 *   community   `/explore`     a link from Explore to Explore
 *   auth        `/`            correct, and unlabelled for screen readers
 *
 * Two of the four did nothing when clicked. That is a specific and quite
 * disorienting kind of broken: the logo is the one control every user assumes
 * they understand, so a logo that does not go home reads as the page having
 * failed to load rather than as a missing link. It was on the roadmap.
 *
 * A shared component makes "where does the logo go" a question with one answer.
 *
 * ## Home is the public homepage, always
 *
 * Not the dashboard, even for signed-in users. The marketing site is where the
 * pricing, the terms and the explanation of the product live, and a subscriber
 * who wants to re-read the pricing page has no other way back to it.
 *
 * Signed-in users are **not** bounced from `/` to `/dashboard`. There is no
 * such redirect anywhere in the app, and adding one would defeat this
 * component: a logo that navigates home and is immediately thrown back is
 * worse than one that never moved.
 *
 * ## It cannot sign anybody out
 *
 * Navigating to `/` is an ordinary client-side navigation to an unprotected
 * route. Clerk's session lives in a cookie and in `ClerkProvider`, neither of
 * which a `next/link` touches. The protected group's `requireUserId()` gate is
 * untouched — it still guards every route under `app/(app)`, which is what
 * makes leaving those routes safe rather than surprising.
 */
export function BrandLink({
  /** Where home is. `/` in English, `/es` on the Spanish marketing tree. */
  href = "/",
  className,
  /** The dashboard sidebar renders slightly smaller than the marketing bar. */
  size = "md",
  /**
   * Drop the wordmark, keeping the icon and the accessible name.
   *
   * For the collapsed sidebar rail, which is 4.5rem wide — about 56px of
   * content once padding is taken. The 28px icon plus "Atheos.io" does not fit,
   * and `truncate` would render a clipped fragment of the brand name. The
   * `aria-label` is unchanged, so a screen reader still hears "Atheos.io home"
   * in both states.
   */
  hideLabel = false,
}: {
  href?: string;
  className?: string;
  size?: "sm" | "md";
  hideLabel?: boolean;
}) {
  return (
    <Link
      href={href}
      // Named rather than left to the wordmark text, because the mark is a
      // gradient square plus a word and a screen reader announcing "Atheos"
      // alone does not say that activating it goes anywhere.
      aria-label={`${SITE.name} home`}
      className={cn(
        "flex w-fit shrink-0 items-center gap-2 font-semibold tracking-tight",
        "rounded-md focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
        className,
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg bg-gradient-brand",
          size === "sm" ? "size-7" : "size-8",
        )}
      >
        <Sparkles className="size-4 text-white" strokeWidth={2} aria-hidden />
      </span>
      {hideLabel ? null : <span className="truncate">{SITE.name}</span>}
    </Link>
  );
}
