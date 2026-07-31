"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toAuthErrorMessage } from "@/features/auth/lib/errors";
import { toast } from "@/lib/toast";

/**
 * Notification preferences.
 *
 * ## Where these are stored, and why
 *
 * In Clerk's `unsafeMetadata`. The name is alarming and worth explaining: it
 * means *user-writable from the browser*, as opposed to `publicMetadata`, which
 * only a backend can set. That is exactly right for preferences — the user is
 * the authority on whether they want an email — and exactly wrong for anything
 * that grants access or costs money. A credit balance in `unsafeMetadata` would
 * be editable from the devtools console.
 *
 * The alternative was a column on our `users` table. That is where these belong
 * long term, since the service that *sends* the email should not have to call
 * Clerk to find out whether it may. It is not done yet because Sprint 3 has no
 * email service to gate, and adding a table column to store a preference
 * nothing reads is speculative work. The migration is a webhook away.
 *
 * ## Optimistic updates
 *
 * The switch flips immediately and rolls back on failure. A toggle that waits
 * for a round trip feels broken — and this panel may hold half a dozen of them.
 *
 * ## Marketing is off by default
 *
 * Opt-in, not opt-out. Required under GDPR for consent-based marketing, and the
 * right default regardless.
 */

interface Preferences {
  generationComplete: boolean;
  generationFailed: boolean;
  creditsLow: boolean;
  productUpdates: boolean;
  marketing: boolean;
}

const DEFAULTS: Preferences = {
  generationComplete: true,
  generationFailed: true,
  creditsLow: true,
  productUpdates: true,
  marketing: false,
};

const ITEMS: {
  key: keyof Preferences;
  label: string;
  description: string;
}[] = [
  {
    key: "generationComplete",
    label: "Generation finished",
    description:
      "When a job completes. Useful for video, which can take several minutes.",
  },
  {
    key: "generationFailed",
    label: "Generation failed",
    description:
      "When a provider rejects or fails a job and your credits are refunded.",
  },
  {
    key: "creditsLow",
    label: "Low credit balance",
    description: "When you drop below 10% of your monthly allowance.",
  },
  {
    key: "productUpdates",
    label: "Product updates",
    description: "New providers, models and features. Roughly monthly.",
  },
  {
    key: "marketing",
    label: "Offers and announcements",
    description: "Occasional news about pricing and events.",
  },
];

function readPreferences(metadata: unknown): Preferences {
  if (typeof metadata !== "object" || metadata === null) return DEFAULTS;
  const stored = (metadata as { notifications?: unknown }).notifications;
  if (typeof stored !== "object" || stored === null) return DEFAULTS;

  // Merge over defaults rather than trusting the stored shape: metadata is
  // user-writable, so it can contain anything at all.
  const result = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof Preferences)[]) {
    const value = (stored as Record<string, unknown>)[key];
    if (typeof value === "boolean") result[key] = value;
  }
  return result;
}

export function NotificationSettings() {
  const { user, isLoaded } = useUser();
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);
  const [pending, setPending] = useState<keyof Preferences | null>(null);

  useEffect(() => {
    if (!user) return;
    setPreferences(readPreferences(user.unsafeMetadata));
  }, [user]);

  async function toggle(key: keyof Preferences, value: boolean) {
    if (!user || pending) return;

    const previous = preferences;
    const next = { ...preferences, [key]: value };

    setPreferences(next); // optimistic
    setPending(key);

    try {
      await user.update({
        unsafeMetadata: {
          ...(user.unsafeMetadata as Record<string, unknown>),
          notifications: next,
        },
      });
    } catch (error) {
      setPreferences(previous); // roll back
      toast.error("Could not save preference", {
        description: toAuthErrorMessage(error),
      });
    } finally {
      setPending(null);
    }
  }

  if (!isLoaded) {
    return (
      <div className="space-y-4">
        {ITEMS.map((item) => (
          <Skeleton key={item.key} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {ITEMS.map((item) => (
        <li
          key={item.key}
          className="flex items-start justify-between gap-6 py-4 first:pt-0 last:pb-0"
        >
          <div className="min-w-0">
            <label
              htmlFor={`notify-${item.key}`}
              className="text-sm font-medium"
            >
              {item.label}
            </label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {item.description}
            </p>
          </div>

          <Switch
            id={`notify-${item.key}`}
            checked={preferences[item.key]}
            onCheckedChange={(value) => toggle(item.key, value)}
            disabled={pending !== null}
            className="mt-0.5 shrink-0"
          />
        </li>
      ))}
    </ul>
  );
}
