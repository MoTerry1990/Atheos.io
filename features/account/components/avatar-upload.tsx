"use client";

import { useUser } from "@clerk/nextjs";
import { Camera, Trash2 } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/loading";
import { toAuthErrorMessage } from "@/features/auth/lib/errors";
import { toast } from "@/lib/toast";

/**
 * Avatar upload.
 *
 * Goes to **Clerk**, not to our own storage, via `user.setProfileImage()`.
 * That is deliberate: Clerk already owns the identity record and serves the
 * image from its CDN with the right cache headers, and routing it through
 * UploadThing or R2 would mean two copies of the same picture with no agreed
 * source of truth. Our `users.imageUrl` column is refreshed from the
 * `user.updated` webhook, so the mirror stays correct without extra work.
 *
 * ## Validation happens before the request
 *
 * Type and size are checked client-side so the user gets an instant, specific
 * error instead of waiting for a 4MB upload to be rejected. This is **not** a
 * security control — Clerk enforces its own limits server-side, which is the
 * check that actually matters. Client-side validation is a courtesy; treating
 * it as protection is a category error.
 *
 * ## The object URL
 *
 * The optimistic preview uses `URL.createObjectURL`, which allocates memory
 * that is only freed by `revokeObjectURL`. Skipping the revoke leaks the whole
 * image on every upload — invisible in testing, obvious after an hour of use.
 */

const MAX_BYTES = 4 * 1024 * 1024; // Clerk's limit
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function AvatarUpload() {
  const { user, isLoaded } = useUser();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset immediately so picking the *same* file twice still fires a change
    // event — otherwise a failed upload cannot be retried with the same image.
    event.target.value = "";
    if (!file || !user) return;

    if (!ACCEPTED.includes(file.type)) {
      toast.error("Unsupported image type", {
        description: "Use a JPEG, PNG, WebP or GIF.",
      });
      return;
    }

    if (file.size > MAX_BYTES) {
      toast.error("Image is too large", {
        description: `Maximum size is 4MB — that one is ${(file.size / 1024 / 1024).toFixed(1)}MB.`,
      });
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setBusy(true);

    try {
      await user.setProfileImage({ file });
      await user.reload();
      toast.success("Profile photo updated");
    } catch (error) {
      toast.error("Could not update photo", {
        description: toAuthErrorMessage(error),
      });
      setPreview(null);
    } finally {
      URL.revokeObjectURL(objectUrl);
      setBusy(false);
    }
  }

  async function removeImage() {
    if (!user) return;
    setBusy(true);
    try {
      await user.setProfileImage({ file: null });
      await user.reload();
      setPreview(null);
      toast.success("Profile photo removed");
    } catch (error) {
      toast.error("Could not remove photo", {
        description: toAuthErrorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  }

  if (!isLoaded) {
    return <div className="size-20 animate-pulse rounded-full bg-muted" />;
  }

  const src = preview ?? user?.imageUrl;
  // Clerk sets `hasImage` false for the auto-generated initials avatar, which
  // is what distinguishes "no photo" from "a photo that happens to be plain".
  const hasCustomImage = Boolean(user?.hasImage);

  return (
    <div className="flex items-center gap-5">
      <div className="relative">
        <div className="size-20 overflow-hidden rounded-full border border-border bg-muted">
          {src ? (
            <Image
              src={src}
              alt=""
              width={80}
              height={80}
              className="size-full object-cover"
              // Clerk and blob URLs are outside Next's optimiser allowlist, and
              // an 80px avatar gains nothing from optimisation anyway.
              unoptimized
            />
          ) : null}
        </div>

        {busy ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
            <Spinner size="sm" className="text-white" />
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <Camera />
            {hasCustomImage ? "Change photo" : "Upload photo"}
          </Button>

          {hasCustomImage ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={removeImage}
            >
              <Trash2 />
              Remove
            </Button>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">
          JPEG, PNG, WebP or GIF. Up to 4MB.
        </p>
      </div>

      {/* Visually hidden rather than `display: none` — a hidden input is not
          focusable, which breaks keyboard access to the file picker. */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        onChange={handleFile}
        className="sr-only"
        aria-label="Upload profile photo"
        tabIndex={-1}
      />
    </div>
  );
}
