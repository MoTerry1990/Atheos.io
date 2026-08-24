"use client";

import { AlertCircle, Search, X } from "lucide-react";
import * as React from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Field — the wrapper that makes an input accessible.
 *
 * A bare `<input>` plus a `<label>` beside it is not a labelled field; the two
 * have to be associated by id, the error has to be announced, and
 * `aria-invalid` has to be set. Doing that by hand at every call site means it
 * is done correctly at roughly half of them.
 *
 * This component generates the ids, wires `aria-describedby` to whichever of
 * hint/error is showing, and passes the state down. The child is a render prop
 * so it works with any control — input, textarea, select, or a third-party
 * combobox — rather than only the ones we thought of.
 *
 *   <Field label="Prompt" error={errors.prompt}>
 *     {(props) => <Textarea {...props} />}
 *   </Field>
 */
export interface FieldRenderProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": boolean | undefined;
  "aria-required": boolean | undefined;
}

export interface FieldProps {
  label?: string;
  /** Helper text. Hidden while an error is showing — two messages compete. */
  hint?: string;
  error?: string;
  required?: boolean;
  /** Visually hides the label but keeps it for screen readers. */
  hideLabel?: boolean;
  className?: string;
  children: (props: FieldRenderProps) => React.ReactNode;
}

export function Field({
  label,
  hint,
  error,
  required,
  hideLabel,
  className,
  children,
}: FieldProps) {
  const id = React.useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  // Error wins: describing a field by both its hint and its error at once is
  // read aloud as one run-on sentence.
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={cn("space-y-2", className)}>
      {label ? (
        <Label
          htmlFor={id}
          className={cn(
            "text-sm font-medium",
            hideLabel && "sr-only",
            error && "text-destructive",
          )}
        >
          {label}
          {required ? (
            <span className="ml-0.5 text-destructive" aria-hidden>
              *
            </span>
          ) : null}
        </Label>
      ) : null}

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required || undefined,
      })}

      {error ? (
        // `role="alert"` so the message is announced the moment it appears,
        // rather than only when focus happens to land on the field.
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-xs text-destructive"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Input with optional leading and trailing adornments.
 *
 * Adornments are positioned absolutely and the input is padded around them,
 * rather than wrapping everything in a flex row with its own border. That keeps
 * the real `<input>` full-width, so clicking anywhere in the visual box focuses
 * it — including the padding beside an icon, which users absolutely do click.
 */
export interface InputWithAdornmentsProps extends React.ComponentProps<"input"> {
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}

export function InputField({
  className,
  leading,
  trailing,
  ...props
}: InputWithAdornmentsProps) {
  return (
    <div className="relative">
      {leading ? (
        <span className="pointer-events-none absolute top-1/2 left-3 flex -translate-y-1/2 items-center text-muted-foreground [&_svg]:size-4">
          {leading}
        </span>
      ) : null}

      <input
        data-slot="input"
        className={cn(
          /**
           * 40px tall, 12px of horizontal padding.
           *
           * Was 36px, which is under the 40px a touch target wants and made the
           * field look cramped beside a 40px button. The single line centres
           * itself in the box, so no vertical padding is needed to fake it.
           */
          "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground",
          "placeholder:text-muted-foreground",
          "transition-[color,box-shadow,border-color] duration-150",
          "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "read-only:cursor-default read-only:opacity-90",
          "aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/30",
          // 16px on mobile: anything smaller makes iOS Safari zoom the viewport
          // when the field receives focus.
          "text-base sm:text-sm",
          // 36px where an adornment sits: the icon starts at 12px and is 16px
          // wide, so 36 leaves 8px between it and the first character. Anything
          // less and a password-reveal or clear button sits on the text.
          leading && "pl-9",
          trailing && "pr-9",
          className,
        )}
        {...props}
      />

      {trailing ? (
        <span className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center text-muted-foreground [&_svg]:size-4">
          {trailing}
        </span>
      ) : null}
    </div>
  );
}

/**
 * SearchInput — a search field with its icon and clear button already placed.
 *
 * Search was the one shape being rebuilt at every call site: a magnifier
 * positioned by hand, sometimes a clear button, each with its own padding
 * guess. Four screens had four slightly different versions, which is how one of
 * them ends up with the icon overlapping the text.
 *
 * `type="search"` is deliberate. It gives the field the right on-screen
 * keyboard on mobile and the right semantics to assistive technology; the
 * browser's own clear affordance is suppressed in favour of ours, which is
 * keyboard-reachable and visible in both themes.
 */
export interface SearchInputProps extends Omit<
  InputWithAdornmentsProps,
  "leading" | "trailing" | "type"
> {
  /** Shown when there is text to clear. Omit for an uncontrolled field. */
  onClear?: () => void;
}

export function SearchInput({
  className,
  onClear,
  value,
  ...props
}: SearchInputProps) {
  const hasValue = typeof value === "string" && value.length > 0;

  return (
    <InputField
      type="search"
      value={value}
      leading={<Search aria-hidden />}
      trailing={
        onClear && hasValue ? (
          <button
            type="button"
            onClick={onClear}
            // Not `aria-hidden`: this is a real control, and a mouse user who
            // can see it should not be the only one able to reach it.
            aria-label="Clear search"
            className="pointer-events-auto rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <X aria-hidden />
          </button>
        ) : undefined
      }
      className={cn(
        // The browser's own clear button would sit on top of ours.
        "[&::-webkit-search-cancel-button]:appearance-none",
        className,
      )}
      {...props}
    />
  );
}
