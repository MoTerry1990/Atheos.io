"use client";

import { AnimatePresence, motion } from "motion/react";
import { Bell, Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { NotificationItem } from "@/features/dashboard/types";
import { formatRelativeTime } from "@/utils/format";
import { cn } from "@/lib/utils";

/**
 * Notifications.
 *
 * ## Read state is local, deliberately
 *
 * Marking as read updates component state and nothing else. There is no
 * notifications table yet — Sprint 6 introduces long-running video jobs, which
 * is the first thing that produces events worth persisting.
 *
 * Rather than pretend, the panel says so in its footer. A "mark all read" that
 * silently forgets on reload is the kind of small dishonesty that erodes trust
 * in everything else on the page, so the limitation is stated where the user
 * would otherwise discover it themselves.
 *
 * ## The unread badge
 *
 * Count is capped at "9+". A three-digit number in a 16px dot is unreadable,
 * and the exact figure past nine changes no decision.
 *
 * The badge is `aria-hidden`; the button's `aria-label` carries the count in
 * words, so a screen reader hears "Notifications, 2 unread" rather than a dot.
 */
export function NotificationsMenu({
  notifications,
}: {
  notifications: NotificationItem[];
}) {
  const [items, setItems] = useState(notifications);
  const unread = items.filter((item) => !item.read).length;

  function markAllRead() {
    setItems((current) => current.map((item) => ({ ...item, read: true })));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={
            unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
          }
        >
          <Bell />

          <AnimatePresence>
            {unread > 0 ? (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ duration: 0.2, ease: [0.34, 1.56, 0.64, 1] }}
                aria-hidden
                className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-2xs font-medium text-primary-foreground tabular-nums"
              >
                {unread > 9 ? "9+" : unread}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0 sm:w-96">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <p className="text-sm font-medium">Notifications</p>
          {unread > 0 ? (
            <button
              type="button"
              onClick={markAllRead}
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <Check className="size-3" aria-hidden />
              Mark all read
            </button>
          ) : null}
        </div>

        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            You are all caught up.
          </p>
        ) : (
          <ScrollArea className="max-h-80">
            <ul className="divide-y divide-border">
              {items.map((item) => {
                const content = (
                  <div
                    className={cn(
                      "flex gap-3 px-3 py-3 transition-colors",
                      !item.read && "bg-primary/5",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1.5 size-1.5 shrink-0 rounded-full",
                        item.read ? "bg-transparent" : "bg-primary",
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.body}
                      </p>
                      <time
                        dateTime={item.at}
                        className="mt-1 block text-xs text-muted-foreground"
                      >
                        {formatRelativeTime(item.at)}
                      </time>
                    </div>
                  </div>
                );

                return (
                  <li key={item.id}>
                    {item.href ? (
                      <Link
                        href={item.href}
                        className="block hover:bg-accent/50"
                      >
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}

        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Read state is not saved yet — persistence lands with background jobs.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
