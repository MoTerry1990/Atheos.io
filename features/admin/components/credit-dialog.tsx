"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputField } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, type AdminUserRow } from "@/features/admin/lib/api";
import { useAdminApi } from "@/features/admin/lib/api-context";
import { toast } from "@/lib/toast";

/**
 * Adjust somebody's credit balance.
 *
 * ## The resulting balance is shown before committing
 *
 * "4,200 → 9,200". A signed number in a box is easy to misread, and the
 * difference between +5000 and -5000 is somebody's month. Showing the outcome
 * is the cheapest possible guard against the most likely mistake.
 *
 * ## The reason is required and goes on the record
 *
 * Not validation theatre — it is the only field that makes the audit entry
 * reviewable, and the moment of the action is the only time anybody will
 * actually write it.
 *
 * ## The idempotency key is generated once per dialog
 *
 * A double-submitted goodwill grant is the exact failure this must not have.
 * The key is minted when the dialog opens and reused for every attempt, so a
 * retry after a network error is the *same* adjustment rather than a second
 * one. It is regenerated on the next open, because that genuinely is a new
 * intent.
 */
export function CreditDialog({
  user,
  onClose,
  onAdjusted,
}: {
  user: AdminUserRow | null;
  onClose: () => void;
  onAdjusted: () => void;
}) {
  const api = useAdminApi();

  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setAmount("");
    setReason("");
    // One key per opening. `crypto.randomUUID` is available in every browser
    // this product supports and does not need a dependency.
    setKey(crypto.randomUUID());
  }, [user]);

  const parsed = Number(amount);
  const valid =
    Number.isInteger(parsed) && parsed !== 0 && reason.trim().length >= 3;
  const resulting = user ? user.creditBalance + (parsed || 0) : 0;
  const wouldGoNegative = resulting < 0;

  async function submit() {
    if (!user || !valid || wouldGoNegative) return;

    setSaving(true);
    try {
      const result = await api.adjustCredits({
        userId: user.id,
        amount: parsed,
        reason: reason.trim(),
        idempotencyKey: key,
      });

      toast.success(
        result.applied ? "Adjustment applied" : "Already applied",
        `Balance is now ${result.balance.toLocaleString("en-US")}`,
      );
      onAdjusted();
      onClose();
    } catch (cause) {
      toast.error("Could not adjust that balance", {
        description:
          cause instanceof ApiError ? cause.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust credits</DialogTitle>
          <DialogDescription>
            {user?.email} — currently{" "}
            {user?.creditBalance.toLocaleString("en-US")} credits. This writes
            to the ledger and to the audit log under your name.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="adjust-amount" className="text-sm font-medium">
              Amount
            </label>
            <InputField
              id="adjust-amount"
              value={amount}
              onChange={(event) =>
                setAmount(event.target.value.replace(/[^\d-]/g, ""))
              }
              placeholder="e.g. 500 or -500"
              inputMode="numeric"
              className="font-mono tabular-nums"
            />
            {/* The outcome, not the input. This is the guard against the
                mistake that actually happens. */}
            {user && parsed ? (
              <p
                className={
                  wouldGoNegative
                    ? "text-2xs text-destructive tabular-nums"
                    : "text-2xs text-muted-foreground tabular-nums"
                }
              >
                {user.creditBalance.toLocaleString("en-US")} →{" "}
                <span className="font-medium">
                  {resulting.toLocaleString("en-US")}
                </span>
                {wouldGoNegative ? " — a balance cannot go below zero" : ""}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="adjust-reason" className="text-sm font-medium">
              Reason
            </label>
            <Textarea
              id="adjust-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Goodwill for the failed batch on 12 August — ticket 431"
              rows={3}
              maxLength={500}
            />
            <p className="text-2xs text-muted-foreground">
              Goes on the permanent record. Write it for whoever reviews this in
              six months.
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant={parsed < 0 ? "destructive" : "default"}
              loading={saving}
              disabled={!valid || wouldGoNegative}
              onClick={() => void submit()}
            >
              {parsed < 0 ? "Deduct" : "Grant"}{" "}
              {Math.abs(parsed || 0).toLocaleString("en-US")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
