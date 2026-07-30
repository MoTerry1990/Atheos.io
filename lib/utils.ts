import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind classes with correct precedence.
 *
 * `clsx` resolves conditionals; `twMerge` then resolves *conflicts* — so a
 * component's `px-4` and a caller's `px-8` produce `px-8` rather than both
 * landing in the class list and letting stylesheet order decide. Every
 * component that accepts a `className` prop must run it through this, otherwise
 * callers cannot reliably override anything.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
