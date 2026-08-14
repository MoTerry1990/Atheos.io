import Link from "next/link";

/**
 * The line beneath the sign-up buttons.
 *
 * ## Why it is a notice and not a checkbox
 *
 * Continuing *is* the agreement, which is how Clerk, Google and most of the
 * industry do it, and it is defensible only if the terms are genuinely
 * reachable before the click. They are: both links go to real documents, and
 * they open in this tab rather than a modal, so somebody who wants to read them
 * can and the back button returns them here.
 *
 * A checkbox would be more explicit. It would also be the fourth thing between
 * a person and an account on a product nobody has heard of yet — worth
 * revisiting when there is something to lose by getting consent wrong.
 *
 * ## The age line is not decoration
 *
 * `acceptable-use` forbids sexual content involving minors and intimate imagery
 * of anyone under 18. Stating the age requirement at the point of sign-up is
 * what makes that rule something the user accepted rather than something we
 * assert afterwards.
 */
export function ConsentNote() {
  return (
    <p className="text-center text-xs leading-relaxed text-muted-foreground">
      By continuing you agree to the{" "}
      <Link
        href="/terms"
        className="text-foreground underline underline-offset-2 transition-colors hover:text-primary"
      >
        Terms
      </Link>{" "}
      and{" "}
      <Link
        href="/privacy"
        className="text-foreground underline underline-offset-2 transition-colors hover:text-primary"
      >
        Privacy Policy
      </Link>
      , and confirm you are at least 18 years old.
    </p>
  );
}
