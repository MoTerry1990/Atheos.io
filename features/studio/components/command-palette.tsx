"use client";

import { Command } from "cmdk";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";

import { chordFor, type Shortcut } from "@/features/studio/lib/shortcuts";
import { cn } from "@/lib/utils";

/**
 * The command palette.
 *
 * ## Why it exists in a studio specifically
 *
 * The composer has grown to five panels of controls. A palette is the answer to
 * a workspace that is dense on purpose: everything stays reachable without
 * everything being on screen, so the surface can be quiet without becoming
 * shallow.
 *
 * It is also the **discovery surface for every shortcut**. Each command shows
 * its chord, so a user who reaches for the palette twice learns the key the
 * third time and stops needing it. A palette that does not teach its own
 * shortcuts trains people to keep using the palette.
 *
 * ## The list comes from the shortcut registry
 *
 * Not a second array. A palette that drifts from the keys it advertises is
 * worse than no palette, and the only reliable way to prevent that is for both
 * to read the same source — see `lib/shortcuts.ts`.
 *
 * ## Motion is deliberately restrained
 *
 * 140ms, opacity and a 4px lift. A palette is a tool someone reaches for
 * mid-thought; anything longer puts a wait between the intent and the list, and
 * a palette that feels slow is one people stop opening. `MotionConfig` in the
 * root layout already honours `prefers-reduced-motion`, so this needs no
 * branch of its own.
 */

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: readonly Shortcut[];
}

export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: CommandPaletteProps) {
  // Lock the background while open. Without this the page scrolls behind the
  // palette on a trackpad, which is disorienting because the thing being
  // scrolled is not the thing with focus.
  useEffect(() => {
    if (!open) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const groups = Array.from(
    commands.reduce((map, command) => {
      const list = map.get(command.group) ?? [];
      list.push(command);
      map.set(command.group, list);
      return map;
    }, new Map<string, Shortcut[]>()),
  );

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          className="fixed inset-0 z-50 grid place-items-start justify-center bg-background/70 pt-[12vh] backdrop-blur-sm"
          onClick={() => onOpenChange(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.99 }}
            transition={{ duration: 0.14, ease: [0.25, 1, 0.5, 1] }}
            className="w-[min(36rem,calc(100vw-2rem))]"
            // The backdrop closes on click; the panel must not.
            onClick={(event) => event.stopPropagation()}
          >
            <Command
              label="Studio commands"
              loop
              className={cn(
                "overflow-hidden rounded-xl border border-border bg-popover shadow-2xl",
                "[&_[cmdk-input]]:h-12 [&_[cmdk-input]]:w-full [&_[cmdk-input]]:bg-transparent",
                "[&_[cmdk-input]]:px-4 [&_[cmdk-input]]:text-sm [&_[cmdk-input]]:outline-none",
              )}
            >
              <div className="border-b border-border">
                <Command.Input
                  autoFocus
                  placeholder="Search commands…"
                  aria-label="Search commands"
                />
              </div>

              <Command.List className="max-h-[min(24rem,50vh)] overflow-y-auto p-1.5">
                <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Nothing matches that.
                </Command.Empty>

                {groups.map(([group, items]) => (
                  <Command.Group
                    key={group}
                    heading={group}
                    className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase"
                  >
                    {items.map((command) => (
                      <Command.Item
                        key={`${command.group}-${command.label}`}
                        // `value` is what cmdk filters on. Including the group
                        // means "queue" finds Navigate items too.
                        value={`${command.label} ${command.group}`}
                        onSelect={() => {
                          onOpenChange(false);
                          command.run();
                        }}
                        className={cn(
                          "flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm",
                          "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
                        )}
                      >
                        <span className="min-w-0 truncate">
                          {command.label}
                        </span>
                        <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                          {chordFor(command)}
                        </kbd>
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * The shortcut reference sheet.
 *
 * Separate from the palette because they answer different questions. The
 * palette is "do the thing"; this is "what can I do". Merging them makes the
 * palette a documentation browser, which is the thing that makes palettes feel
 * bloated.
 *
 * Reads the same registry, so it cannot describe a key that does not work.
 */
export function ShortcutSheet({
  open,
  onOpenChange,
  shortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortcuts: readonly Shortcut[];
}) {
  const groups = Array.from(
    shortcuts.reduce((map, shortcut) => {
      const list = map.get(shortcut.group) ?? [];
      list.push(shortcut);
      map.set(shortcut.group, list);
      return map;
    }, new Map<string, Shortcut[]>()),
  );

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 backdrop-blur-sm"
          onClick={() => onOpenChange(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.25, 1, 0.5, 1] }}
            onClick={(event) => event.stopPropagation()}
            className="w-[min(32rem,100%)] rounded-xl border border-border bg-popover p-5 shadow-2xl"
          >
            {/* `h2`, not `h1` — the workspace owns the page's only h1. */}
            <h2 className="text-sm font-medium">Keyboard shortcuts</h2>

            <div className="mt-4 space-y-5">
              {groups.map(([group, items]) => (
                <div key={group}>
                  <p className="mb-2 text-2xs font-medium tracking-wider text-muted-foreground uppercase">
                    {group}
                  </p>
                  <dl className="space-y-1.5">
                    {items.map((shortcut) => (
                      <div
                        key={`${group}-${shortcut.label}`}
                        className="flex items-center justify-between gap-4 text-sm"
                      >
                        <dt className="min-w-0 truncate text-muted-foreground">
                          {shortcut.label}
                        </dt>
                        <dd>
                          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-2xs">
                            {chordFor(shortcut)}
                          </kbd>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
