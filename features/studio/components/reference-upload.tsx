"use client";

import { ImagePlus, X } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";

import { Slider } from "@/components/ui/slider";
import { Control } from "@/features/studio/components/model-picker";
import { findModel } from "@/features/studio/data/models";
import { useStudioStore } from "@/store/studio-store";
import { formatBytes } from "@/utils/format";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Reference images.
 *
 * ## Nothing is uploaded yet
 *
 * Files stay in the browser as object URLs. There is no provider to send them
 * to until Sprint 6, and uploading to storage now would mean paying to keep
 * files nothing can consume. The store strips references from persistence for
 * the same reason an object URL is meaningless in a later session.
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
  const modelId = useStudioStore((state) => state.params.modelId);
  const references = useStudioStore((state) => state.params.references);
  const addReference = useStudioStore((state) => state.addReference);
  const removeReference = useStudioStore((state) => state.removeReference);
  const setStrength = useStudioStore((state) => state.setReferenceStrength);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const model = findModel(modelId);
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

      addReference({
        id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        url: URL.createObjectURL(file),
        sizeBytes: file.size,
        strength: 0.6,
      });
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
                  <p className="truncate text-xs font-medium">
                    {reference.name}
                  </p>
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
