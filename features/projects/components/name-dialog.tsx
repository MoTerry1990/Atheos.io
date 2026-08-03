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

/**
 * One dialog for "name this thing".
 *
 * Create a project, rename a project, rename a folder — the same question with
 * different words around it. Three near-identical dialogs would be three places
 * to fix the same bug about trimming, or about Enter not submitting.
 *
 * `key`ed on `initialName` by the caller so reopening it for a different target
 * resets the field. A `useEffect` syncing props into state would work too, and
 * would run on every render for the sake of one.
 */
export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initialName,
  initialDescription,
  withDescription = false,
  confirmLabel,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  initialName?: string;
  initialDescription?: string;
  withDescription?: boolean;
  confirmLabel: string;
  pending?: boolean;
  onSubmit: (values: { name: string; description?: string }) => void;
}) {
  const [name, setName] = useState(initialName ?? "");
  const [blurb, setBlurb] = useState(initialDescription ?? "");

  // Reset when the dialog opens for a new target. Cheaper and more predictable
  // than remounting the whole dialog from the caller.
  useEffect(() => {
    if (open) {
      setName(initialName ?? "");
      setBlurb(initialDescription ?? "");
    }
  }, [open, initialName, initialDescription]);

  const valid = name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || pending) return;
            onSubmit({
              name: name.trim(),
              ...(withDescription ? { description: blurb.trim() } : {}),
            });
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="name-dialog-name" className="text-sm font-medium">
              {label}
            </label>
            <InputField
              id="name-dialog-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
            />
          </div>

          {withDescription ? (
            <div className="space-y-1.5">
              <label
                htmlFor="name-dialog-description"
                className="text-sm font-medium"
              >
                Description{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <Textarea
                id="name-dialog-description"
                value={blurb}
                onChange={(event) => setBlurb(event.target.value)}
                maxLength={400}
                rows={3}
              />
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!valid} loading={pending}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
