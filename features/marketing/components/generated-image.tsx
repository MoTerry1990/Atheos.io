import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * A real generation, shown on the marketing site.
 *
 * ## Every one of these is genuine output
 *
 * `public/marketing/*.webp` came out of `scripts/generate-marketing-assets.ts`,
 * which runs the same pinned model versions the product runs. That is the whole
 * point: this page is the only place a visitor can judge output quality before
 * signing up, and decorating it with stock photography would be a lie told at
 * the exact moment trust is being decided.
 *
 * The prompt travels with the image and is shown on the tile. An AI product
 * displaying generated work *without* the prompt is asking to be doubted —
 * and the prompt is genuinely the interesting part.
 *
 * ## Alt text
 *
 * The prompt is the alt text, prefixed to say what the image is. A screen
 * reader user is owed the same information the sighted visitor gets, which
 * here is "an AI generation, made from these words" — not a description of the
 * pixels, which nobody wrote and we cannot verify.
 *
 * Until this component existed the marketing site rendered **zero** `<img>`
 * elements, which is why the Playwright alt-text sweep had been passing
 * against nothing for eight sprints. It has something to check now.
 */
export function GeneratedImage({
  src,
  prompt,
  className,
  sizes,
  priority = false,
}: {
  /** Path under `/marketing`, without the extension. */
  src: string;
  /** The prompt that produced it. Becomes the alt text. */
  prompt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={`/marketing/${src}.webp`}
      alt={`AI generation from the prompt: ${prompt}`}
      fill
      sizes={
        sizes ?? "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
      }
      priority={priority}
      className={cn("object-cover", className)}
    />
  );
}
