"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { LogOut } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, InputField } from "@/components/ui/field";
import { toAuthErrorMessage } from "@/features/auth/lib/errors";
import { toast } from "@/lib/toast";

/**
 * Sign out, and account deletion.
 *
 * ## Type-to-confirm
 *
 * Deletion requires typing the account's email address. This is not
 * decoration — it is the difference between a misclick and an intention. The
 * action is irreversible and cascades: generations, assets, collections and the
 * whole credit ledger go with the user row (see the `onDelete: Cascade`
 * relations in `schema.prisma`).
 *
 * `AlertDialog` rather than `Dialog`, so it cannot be dismissed by clicking
 * outside — a destructive confirmation should require an explicit choice.
 *
 * ## Deleting through Clerk
 *
 * `user.delete()` removes the identity, and the `user.deleted` webhook removes
 * our row. Deleting our row directly would leave a live Clerk account that can
 * still sign in, landing on a broken session with no profile — the worst of
 * both outcomes.
 *
 * The consequences are listed before the confirm control, not after. A warning
 * placed below the button is read after the decision is made.
 */
export function DangerZone() {
  const { user } = useUser();
  const { signOut } = useClerk();

  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const canDelete = confirmation.trim().toLowerCase() === email.toLowerCase();

  async function handleDelete() {
    if (!user || !canDelete || deleting) return;

    setDeleting(true);
    try {
      await user.delete();
      // Clerk clears the session on delete; this sends them somewhere valid
      // rather than leaving them on a page that no longer has an account.
      await signOut({ redirectUrl: "/" });
    } catch (error) {
      toast.error("Could not delete account", {
        description: toAuthErrorMessage(error),
      });
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Sign out</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            End this session on this device.
          </p>
        </div>
        <Button variant="outline" onClick={() => signOut({ redirectUrl: "/" })}>
          <LogOut />
          Sign out
        </Button>
      </div>

      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
        <p className="text-sm font-medium text-destructive">Delete account</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Permanently removes your account, your generations, your assets and
          your credit history. This cannot be undone and credits are not
          refundable.
        </p>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="mt-4">
              Delete account
            </Button>
          </AlertDialogTrigger>

          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>This immediately and permanently removes:</p>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    <li>Your profile and sign-in credentials</li>
                    <li>Every generation and asset in your library</li>
                    <li>Your collections</li>
                    <li>Your remaining credits and full credit history</li>
                  </ul>
                  <p>There is no way to recover any of it.</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>

            <Field
              label={`Type ${email} to confirm`}
              hint="This is deliberately tedious."
            >
              {(props) => (
                <InputField
                  {...props}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder={email}
                  autoComplete="off"
                />
              )}
            </Field>

            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setConfirmation("")}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  // Keep the dialog open while the request is in flight;
                  // AlertDialogAction closes on click by default.
                  event.preventDefault();
                  void handleDelete();
                }}
                disabled={!canDelete || deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
