import { Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { SITE } from "@/features/marketing/content";

/**
 * The frame every auth screen sits in.
 *
 * Split layout: form on the left, atmosphere on the right. The right panel is
 * hidden below `lg` — on a phone, a decorative half-screen would push the form
 * itself below the fold, and nobody has ever completed a sign-up by admiring a
 * gradient.
 *
 * The logo links home. A sign-in page with no way out is a trap, and the most
 * common reason someone lands here by accident is a mistyped URL.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh">
      <div className="flex w-full flex-col justify-center px-4 py-12 sm:px-8 lg:w-1/2 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Link
            href="/"
            className="mb-10 flex w-fit items-center gap-2 font-semibold tracking-tight"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-brand">
              <Sparkles
                className="size-4 text-white"
                strokeWidth={2}
                aria-hidden
              />
            </span>
            {SITE.name}
          </Link>

          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-2 text-sm text-balance text-muted-foreground">
              {description}
            </p>
          ) : null}

          <div className="mt-8">{children}</div>

          {footer ? (
            <div className="mt-8 text-sm text-muted-foreground">{footer}</div>
          ) : null}
        </div>
      </div>

      {/* Decorative. Reuses the landing page's visual language so signing up
          does not feel like being handed off to a different product. */}
      <div
        aria-hidden
        className="relative hidden overflow-hidden border-l bg-surface-sunken lg:block lg:w-1/2"
      >
        <div className="absolute inset-0 bg-aurora" />
        <div className="absolute inset-0 bg-grid opacity-40" />
        <div
          className="orb top-1/4 -left-24 size-[36rem]"
          style={{
            background: "var(--color-brand-500)",
            animation: "drift 26s var(--ease-out-quart) infinite",
          }}
        />
        <div
          className="orb right-[-6rem] bottom-10 size-[28rem]"
          style={{
            background: "var(--color-info-500)",
            animation: "drift 32s var(--ease-out-quart) infinite",
            animationDelay: "-10s",
          }}
        />
        <div className="absolute inset-0 grain opacity-[0.12] mix-blend-overlay" />

        <div className="absolute inset-x-0 bottom-0 p-12">
          <p className="max-w-md text-xl font-medium tracking-tight text-balance">
            {SITE.tagline}
          </p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            {SITE.description}
          </p>
        </div>
      </div>
    </div>
  );
}
