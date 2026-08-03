"use client";

import { useEffect } from "react";

/**
 * Keyboard shortcuts, declared in one place.
 *
 * ## Why a registry rather than handlers on components
 *
 * Shortcuts scattered across components produce two bugs that are invisible
 * until someone hits them: two components claiming the same key, and a shortcut
 * that fires while the user is typing. Both are structural, so both are solved
 * structurally — one list, one listener, one guard.
 *
 * The list is also the **help overlay's data source**. A shortcut that works and
 * is not discoverable may as well not exist, and the reliable way to keep the
 * help sheet honest is to generate it from the same array the handler reads.
 */

export interface Shortcut {
  /** Lowercase `event.key`, or a single digit. */
  key: string;
  /** Requires Cmd on macOS, Ctrl elsewhere. */
  mod?: boolean;
  shift?: boolean;
  label: string;
  /** Grouping in the help overlay. */
  group: "Generate" | "Navigate" | "Workspace";
  run: () => void;
  /**
   * Allow the shortcut while a text field has focus.
   *
   * Off by default and that default is the important part. A bare `g` bound to
   * "generate" would fire on every `g` typed into a prompt — the single most
   * common way a shortcut system becomes something users disable.
   *
   * Only chords with a modifier set this, because a modifier is a deliberate
   * act that cannot be produced by ordinary typing.
   */
  allowInInput?: boolean;
}

/** True when focus is somewhere the user is composing text. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/** Cmd on Apple platforms, Ctrl everywhere else. */
export function isMacLike(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent);
}

function matches(event: KeyboardEvent, shortcut: Shortcut): boolean {
  if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) return false;

  const wantsMod = shortcut.mod ?? false;
  // `metaKey || ctrlKey` rather than branching on platform: a Mac user with an
  // external PC keyboard reaches for Ctrl, and refusing them is pedantry.
  const hasMod = event.metaKey || event.ctrlKey;
  if (wantsMod !== hasMod) return false;

  return (shortcut.shift ?? false) === event.shiftKey;
}

/**
 * Bind a set of shortcuts for as long as the component is mounted.
 *
 * Listens on `keydown` at the document, capture phase off: a dialog that wants
 * to swallow Escape should get it first, and capture would take it away.
 */
export function useShortcuts(shortcuts: readonly Shortcut[], enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      // A modifier chord in progress is not a shortcut yet.
      if (event.isComposing) return;

      for (const shortcut of shortcuts) {
        if (!matches(event, shortcut)) continue;
        if (isTyping(event.target) && !shortcut.allowInInput) continue;

        event.preventDefault();
        shortcut.run();
        return;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shortcuts, enabled]);
}

/** Render a shortcut as the chord a user would press on their platform. */
export function chordFor(shortcut: Shortcut, mac = isMacLike()): string {
  const parts: string[] = [];
  if (shortcut.mod) parts.push(mac ? "⌘" : "Ctrl");
  if (shortcut.shift) parts.push(mac ? "⇧" : "Shift");
  parts.push(
    shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key,
  );
  return parts.join(mac ? "" : "+");
}
