"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, InputField } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { toAuthErrorMessage } from "@/features/auth/lib/errors";
import { toast } from "@/lib/toast";

/**
 * Name fields.
 *
 * ## Why email is read-only here
 *
 * Changing an email address is not a form field — it is a flow. The new address
 * has to be verified before it becomes the account identity, or anyone who
 * borrows an unlocked laptop can quietly repoint the account at their own inbox
 * and then use password reset to take it over. Clerk's `<UserProfile>` handles
 * that flow properly, so email changes go there rather than being half-built
 * here.
 *
 * ## Dirty tracking
 *
 * Save is disabled until something actually changes. Without it, users press
 * Save on an unchanged form, get a success toast, and reasonably wonder what
 * they just did.
 *
 * The effect resyncs local state when the Clerk user loads or changes
 * elsewhere — otherwise the inputs stay empty on first paint and then never
 * populate.
 */
export function ProfileForm() {
  const { user, isLoaded } = useUser();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName ?? "");
    setLastName(user.lastName ?? "");
  }, [user]);

  const dirty =
    isLoaded &&
    user !== null &&
    user !== undefined &&
    (firstName !== (user.firstName ?? "") ||
      lastName !== (user.lastName ?? ""));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!user || saving || !dirty) return;

    setSaving(true);
    try {
      await user.update({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      toast.success("Profile updated");
    } catch (error) {
      toast.error("Could not save changes", {
        description: toAuthErrorMessage(error),
      });
    } finally {
      setSaving(false);
    }
  }

  if (!isLoaded) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name">
          {(props) => (
            <InputField
              {...props}
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              autoComplete="given-name"
              placeholder="Alex"
            />
          )}
        </Field>

        <Field label="Last name">
          {(props) => (
            <InputField
              {...props}
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              autoComplete="family-name"
              placeholder="Rivera"
            />
          )}
        </Field>
      </div>

      <Field
        label="Email"
        hint="Changing your email requires verification — manage it from your account menu."
      >
        {(props) => (
          <InputField {...props} value={email} readOnly disabled type="email" />
        )}
      </Field>

      <div className="flex justify-end">
        <Button
          type="submit"
          variant="gradient"
          loading={saving}
          disabled={!dirty}
        >
          Save changes
        </Button>
      </div>
    </form>
  );
}
