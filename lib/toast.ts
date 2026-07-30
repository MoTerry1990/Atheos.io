import { toast as sonner } from "sonner";

/**
 * Toast helpers.
 *
 * A thin wrapper over Sonner so that call sites express *intent* — "this
 * succeeded", "this failed" — rather than restating duration and styling at
 * every use. It also gives us one place to change toast behaviour globally,
 * which matters the first time someone decides errors should stay on screen
 * longer.
 *
 * Durations are asymmetric on purpose: **failures persist, successes fade**.
 * A success the user missed costs nothing; an error they missed costs them the
 * next ten minutes wondering why nothing happened.
 *
 * What a toast is *not* for: anything the user must act on. Toasts are
 * dismissible, time out, and stack — put required decisions in a dialog.
 */

const SHORT = 3500;
const LONG = 6000;

export const toast = {
  success(message: string, description?: string) {
    return sonner.success(message, { description, duration: SHORT });
  },

  /** Stays until dismissed if it carries an action — errors deserve a fix. */
  error(
    message: string,
    options?: {
      description?: string;
      action?: { label: string; onClick: () => void };
    },
  ) {
    return sonner.error(message, {
      description: options?.description,
      action: options?.action,
      duration: options?.action ? Infinity : LONG,
    });
  },

  warning(message: string, description?: string) {
    return sonner.warning(message, { description, duration: LONG });
  },

  info(message: string, description?: string) {
    return sonner(message, { description, duration: SHORT });
  },

  /** Manual loading toast. Returns the id so the caller can resolve it. */
  loading(message: string) {
    return sonner.loading(message, { duration: Infinity });
  },

  /**
   * Binds a toast to a promise: loading while pending, then success or error.
   *
   * Preferred over calling `loading` and dismissing by hand, because it cannot
   * leak a stuck spinner when the promise rejects on a path you forgot about.
   */
  promise<T>(
    promise: Promise<T>,
    messages: {
      loading: string;
      success: string | ((data: T) => string);
      error: string | ((error: unknown) => string);
    },
  ) {
    return sonner.promise(promise, messages);
  },

  dismiss(id?: string | number) {
    return sonner.dismiss(id);
  },
};
