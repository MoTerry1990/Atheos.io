"use client";

import { AlertCircle, ImagePlus, Loader2, X } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";

import { Slider } from "@/components/ui/slider";
import { Control } from "@/features/studio/components/model-picker";
import { ApiError, uploadReference } from "@/features/studio/lib/api";
import { useStudioStore } from "@/store/studio-store";
import { useSelectedModel } from "@/features/studio/lib/use-model";
import { formatBytes } from "@/utils/format";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Reference images.
 *
 * ## Uploaded on drop, not on submit
 *
 * A provider fetches the source image itself, so it needs a URL on the public
 * internet — an object URL means nothing outside this tab. Sprint 6 left
 * references local because nothing consumed them; image-to-image and
 * image-to-video both do, so they now go to our storage the moment they are
 * added.
 *
 * Uploading on drop rather than at submit is what keeps the Generate button
 * fast. Uploading 10MB *after* the button is pressed would put a long silent
 * pause between the click and anything happening, and the failure would arrive
 * at the worst possible moment.
 *
 * The preview still uses the object URL. Rendering the remote copy would make
 * the thumbnail depend on a round trip through the CDN for an image already in
 * memory.
 *
 * ## Per-reference strength
 *
 * A single global "reference strength" is the common shortcut and it is wrong
 * as soon as there are two references — a composition reference and a colour
 * reference want very different weights. Storing strength per image costs
 * nothing now and avoids a migration later.
 *
 * ## Validation is a courtesy, not a control
 *
 * Type and size are checked here so the user gets an instant, specific message.
 * The real limits are enforced server-side in Sprint 6. Treating a client-side
 * check as protection is a category error; treating it as UX is correct.
 */

const MAX_REFERENCES = 4;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export function ReferenceUpload() {
  const references = useStudioStore((state) => state.params.references);
  const addReference = useStudioStore((state) => state.addReference);
  const removeReference = useStudioStore((state) => state.removeReference);
  const setStrength = useStudioStore((state) => state.setReferenceStrength);
  const settleReference = useStudioStore((state) => state.settleReference);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const model = useSelectedModel();
  if (!model.capabilities.supportsImageInput) {
    return (
      <p className="text-xs text-muted-foreground">
        {model.displayName} does not accept reference images.
      </p>
    );
  }

  const full = references.length >= MAX_REFERENCES;

  function accept(files: FileList | null) {
    if (!files) return;

    for (const file of Array.from(files)) {
      if (references.length >= MAX_REFERENCES) {
        toast.warning(`Up to ${MAX_REFERENCES} references`);
        break;
      }
      if (!ACCEPTED.includes(file.type)) {
        toast.error("Unsupported image type", {
          description: "Use a JPEG, PNG or WebP.",
        });
        continue;
      }
      if (file.size > MAX_BYTES) {
        toast.error("Image is too large", {
          description: `Maximum 10MB — that one is ${formatBytes(file.size)}.`,
        });
        continue;
      }

      const id = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      addReference({
        id,
        name: file.name,
        url: URL.createObjectURL(file),
        sizeBytes: file.size,
        strength: 0.6,
        status: "uploading",
      });

      // Deliberately not awaited: dropping four files should start four
      // uploads, not queue them. Each settles into the store independently, and
      // the Generate button waits for all of them.
      uploadReference(file)
        .then((result) => settleReference(id, { remoteUrl: result.url }))
        .catch((cause) =>
          settleReference(id, {
            error:
              cause instanceof ApiError ? cause.message : "The upload failed.",
          }),
        );
    }
  }

  return (
    <Control
      label="Reference images"
      hint={`${references.length} / ${MAX_REFERENCES}`}
    >
      <div className="space-y-3">
        {references.length > 0 ? (
          <ul className="space-y-2">
            {references.map((reference) => (
              <li
                key={reference.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-2"
              >
                <div className="size-12 shrink-0 overflow-hidden rounded-md bg-muted">
                  <Image
                    src={reference.url}
                    alt=""
                    width={48}
                    height={48}
                    className="size-full object-cover"
                    // Blob URLs cannot be optimised, and a 48px thumbnail
                    // would gain nothing if they could.
                    unoptimized
                  />
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="flex items-center gap-1.5 truncate text-xs font-medium">
                    {reference.status === "uploading" ? (
                      <Loader2
                        className="size-3 shrink-0 animate-spin text-muted-foreground"
                        aria-hidden
                      />
                    ) : null}
                    {reference.status === "failed" ? (
                      <AlertCircle
                        className="size-3 shrink-0 text-destructive"
                        aria-hidden
                      />
                    ) : null}
                    <span className="truncate">{reference.name}</span>
                  </p>

                  {/* Said out loud rather than left to a spinner: until this
                      finishes the image cannot be sent, and a user who presses
                      Generate deserves to know why it is waiting. */}
                  {reference.status !== "ready" ? (
                    <p
                      className={cn(
                        "text-2xs",
                        reference.status === "failed"
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {reference.status === "failed"
                        ? (reference.error ?? "Upload failed.")
                        : "Uploading…"}
                    </p>
                  ) : null}

                  <div className="flex items-center gap-2">
                    <Slider
                      value={[reference.strength]}
                      onValueChange={([value]) =>
                        setStrength(reference.id, value)
                      }
                      min={0}
                      max={1}
                      step={0.05}
                      aria-label={`Influence of ${reference.name}`}
                      className="flex-1"
                    />
                    <span className="w-9 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                      {Math.round(reference.strength * 100)}%
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => removeReference(reference.id)}
                  aria-label={`Remove ${reference.name}`}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {!full ? (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              accept(event.dataTransfer.files);
            }}
            className={cn(
              "rounded-lg border border-dashed p-4 text-center transition-colors",
              dragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-border/80",
            )}
          >
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center gap-1.5"
            >
              <ImagePlus className="size-5 text-muted-foreground" aria-hidden />
              <span className="text-xs font-medium">
                Drop an image or browse
              </span>
              <span className="text-xs text-muted-foreground">
                JPEG, PNG or WebP · up to 10MB
              </span>
            </button>
          </div>
        ) : null}

        {/* Visually hidden rather than `display:none` — a hidden input cannot
            receive focus, which breaks keyboard access to the file picker. */}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(",")}
          multiple
          onChange={(event) => {
            accept(event.target.files);
            // Reset so choosing the same file twice still fires a change event.
            event.target.value = "";
          }}
          className="sr-only"
          aria-label="Add reference images"
          tabIndex={-1}
        />
      </div>
    </Control>
  );
}
