/**
 * Presentation-layer formatting.
 *
 * Pure functions only — no imports from `lib/`, no side effects, no I/O. That
 * constraint is what makes this directory safe to use from both server and
 * client components without thinking about it.
 */

/** Human-readable file size. Uses binary units, because that is what an
 *  operating system will report for the same file. */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / Math.pow(1024, exponent);

  // Whole bytes never need a decimal point.
  return `${value.toFixed(exponent === 0 ? 0 : decimals)} ${units[exponent]}`;
}

/** Media duration as m:ss, or h:mm:ss past an hour. */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";

  const total = Math.round(milliseconds / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Credits, grouped. Always an integer — fractional credits are a support
 *  ticket waiting to happen. */
export function formatCredits(credits: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Math.trunc(credits));
}

/** Money from the minor units Stripe deals in. Never do this arithmetic with
 *  floats anywhere but the very last step before display. */
export function formatCurrency(
  amountInCents: number,
  currency = "USD",
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amountInCents / 100);
}

/** Relative time — "3 minutes ago". Uses the platform formatter so it reads
 *  correctly in whatever locale we add later, rather than hard-coding English. */
export function formatRelativeTime(date: Date | string | number): string {
  const then = new Date(date).getTime();
  if (Number.isNaN(then)) return "—";

  const seconds = Math.round((then - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  const thresholds: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];

  for (const [unit, size] of thresholds) {
    if (Math.abs(seconds) >= size) {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return formatter.format(seconds, "second");
}

/** Shorten a prompt for a card or list row without cutting mid-word. */
export function truncatePrompt(prompt: string, maxLength = 120): string {
  const clean = prompt.trim().replace(/\s+/g, " ");
  if (clean.length <= maxLength) return clean;

  const cut = clean.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}
