"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * Debounced autosave.
 *
 * ## Why this is not just a `setTimeout` in a component
 *
 * Three things go wrong with the obvious version, and all three are the kind of
 * bug that costs someone their work:
 *
 * 1. **Unmounting mid-debounce silently drops the edit.** Navigating away two
 *    seconds after typing loses it, and nothing tells the user. `flush()` is
 *    called on unmount so the pending change is sent.
 * 2. **Overlapping saves can land out of order.** Two edits in flight can be
 *    applied newest-first, leaving the older value in the database. A save
 *    while one is running sets a "save again after" flag instead of racing.
 * 3. **"Saved" is claimed before it is true.** Showing a tick on keystroke is
 *    an interface lying about durability. The state machine here only reaches
 *    `saved` after the request resolves.
 *
 * ## Why not a Save button
 *
 * A button is honest and slower, and the thing being edited is a name and some
 * notes — low-stakes, frequently adjusted, and unpleasant to have to confirm.
 * The indicator is the compensation: it always says which of the five states is
 * true, and `error` is sticky until the next successful save.
 */
export function useAutosave<T>(
  save: (value: T) => Promise<unknown>,
  options: { delayMs?: number } = {},
) {
  const delayMs = options.delayMs ?? 700;

  const [state, setState] = useState<SaveState>("idle");

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<T | null>(null);
  const inFlight = useRef(false);
  const again = useRef(false);
  const saveRef = useRef(save);

  // Kept in a ref so a caller does not have to memoise the save function to
  // avoid resetting the debounce on every render.
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    if (pending.current === null) return;

    if (inFlight.current) {
      again.current = true;
      return;
    }

    const value = pending.current;
    pending.current = null;
    inFlight.current = true;
    setState("saving");

    try {
      await saveRef.current(value);
      setState("saved");
    } catch {
      // The value stays in `pending` so a later flush retries it rather than
      // discarding an edit the user believes they made.
      pending.current = value;
      setState("error");
    } finally {
      inFlight.current = false;
      if (again.current) {
        again.current = false;
        void flush();
      }
    }
  }, []);

  const schedule = useCallback(
    (value: T) => {
      pending.current = value;
      setState("dirty");

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delayMs);
    },
    [flush, delayMs],
  );

  // Send whatever is pending when the component goes away. Without this, an
  // edit made just before navigating is lost with no indication.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current !== null) void flush();
    };
  }, [flush]);

  return { state, schedule, flush };
}
