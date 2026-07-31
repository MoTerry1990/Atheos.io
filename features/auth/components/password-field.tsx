"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { Field, InputField } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * Password input with a reveal toggle and optional strength meter.
 *
 * ## The reveal toggle
 *
 * Not a nicety. Masked input is the single largest source of sign-up failure on
 * mobile, where autocorrect and small keys make typos invisible until the form
 * rejects them. The button is `type="button"` — inside a form, a bare `<button>`
 * defaults to `type="submit"` and would submit the form on click.
 *
 * ## The strength meter
 *
 * Deliberately crude, and deliberately **not** blocking. It reflects length and
 * variety, which correlate loosely with strength. Clerk does the real check
 * server-side, including a breached-password lookup that no client-side meter
 * can replicate. Showing a meter that says "strong" for a breached password
 * would be worse than showing nothing, so the copy frames it as a hint.
 */

function scorePassword(value: string): number {
  if (!value) return 0;
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(score, 4);
}

const LEVELS = [
  { label: "Too short", className: "bg-destructive" },
  { label: "Weak", className: "bg-destructive" },
  { label: "Fair", className: "bg-warning" },
  { label: "Good", className: "bg-success" },
  { label: "Strong", className: "bg-success" },
];

export function PasswordField({
  label = "Password",
  value,
  onChange,
  error,
  hint,
  autoComplete = "current-password",
  showStrength = false,
  required = true,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  autoComplete?: "current-password" | "new-password";
  showStrength?: boolean;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const score = scorePassword(value);

  return (
    <div className="space-y-2">
      <Field label={label} error={error} hint={hint} required={required}>
        {(props) => (
          <InputField
            {...props}
            type={visible ? "text" : "password"}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            // `new-password` tells a password manager to offer a generated one;
            // `current-password` tells it to fill the saved one. Getting this
            // wrong is why managers sometimes offer to save the wrong thing.
            autoComplete={autoComplete}
            placeholder="••••••••"
            trailing={
              <button
                type="button"
                onClick={() => setVisible((v) => !v)}
                aria-label={visible ? "Hide password" : "Show password"}
                aria-pressed={visible}
                className="pointer-events-auto text-muted-foreground transition-colors hover:text-foreground"
              >
                {visible ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            }
          />
        )}
      </Field>

      {showStrength && value ? (
        <div className="space-y-1.5">
          <div className="flex gap-1" aria-hidden>
            {[0, 1, 2, 3].map((index) => (
              <div
                key={index}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors",
                  index < score ? LEVELS[score].className : "bg-muted",
                )}
              />
            ))}
          </div>
          {/* Announced politely so it does not interrupt typing. */}
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {LEVELS[score].label} — a longer passphrase beats a complicated
            short one.
          </p>
        </div>
      ) : null}
    </div>
  );
}
