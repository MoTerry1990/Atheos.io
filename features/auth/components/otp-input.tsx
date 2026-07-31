"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Six-digit verification code input.
 *
 * ## Why one real input, not six
 *
 * The common implementation is six separate `<input maxlength="1">` boxes with
 * focus juggling. It looks right and behaves badly: password managers cannot
 * fill it, iOS SMS autofill does not recognise it, paste only fills the first
 * box, and backspace across boundaries is a maze of edge cases.
 *
 * This is **one** input holding all six digits, visually covered by six boxes.
 * Consequences, all good: `autoComplete="one-time-code"` works, so iOS offers
 * the code from the Messages notification; paste works; select-all works; screen
 * readers announce one coherent field instead of six unlabelled ones.
 *
 * The boxes are `aria-hidden` decoration. The input carries the accessible name.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled,
  label = "Verification code",
  autoFocus = true,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  length?: number;
  disabled?: boolean;
  label?: string;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  // Fire once, when the last digit arrives, so the caller can auto-submit.
  useEffect(() => {
    if (value.length === length) onComplete?.(value);
    // `onComplete` is intentionally omitted: callers commonly pass an inline
    // arrow, and including it would re-fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, length]);

  const digits = value.split("");
  const activeIndex = Math.min(value.length, length - 1);

  return (
    <div className="space-y-2">
      <label htmlFor="otp-input" className="sr-only">
        {label}
      </label>

      <div
        className="relative"
        onClick={() => inputRef.current?.focus()}
        role="presentation"
      >
        <input
          ref={inputRef}
          id="otp-input"
          value={value}
          onChange={(event) => {
            // Strip everything that is not a digit, so a pasted "123 456" or
            // "Your code is 123456" still works.
            const next = event.target.value.replace(/\D/g, "").slice(0, length);
            onChange(next);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={disabled}
          autoFocus={autoFocus}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label={label}
          className="absolute inset-0 z-10 h-full w-full cursor-default opacity-0"
        />

        <div className="flex justify-between gap-2" aria-hidden>
          {Array.from({ length }).map((_, index) => {
            const active = focused && index === activeIndex;
            return (
              <div
                key={index}
                className={cn(
                  "flex h-12 flex-1 items-center justify-center rounded-lg border text-lg font-medium tabular-nums transition-all",
                  "border-input bg-background",
                  active && "border-ring ring-2 ring-ring/40",
                  disabled && "opacity-50",
                )}
              >
                {digits[index] ?? ""}
                {/* Caret, drawn only in the box the next digit lands in. */}
                {active && !digits[index] ? (
                  <span className="h-5 w-px animate-pulse bg-foreground" />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
