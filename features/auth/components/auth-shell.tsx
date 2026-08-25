import { BrandLink } from "@/components/layout/brand-link";

import { AuthPanelVideo } from "@/features/auth/components/auth-panel-video";
import type { ReactNode } from "react";

import { getCopy } from "@/features/marketing/i18n/dictionaries";

// These surfaces are English-only today: the auth screens and the OG image
// are not locale-routed. Reading the dictionary rather than inlining the
// strings means they follow when they are.
const copy = getCopy("en");

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
          <BrandLink className="mb-10" />

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
        {/* A real generation, from the same wan-2.2 version the product runs —
            see scripts/generate-marketing-assets.ts. The panel beside a sign-up
            form is the last thing somebody looks at before deciding whether the
            output is worth an account, so stock footage here would be the worst
            possible place for it.

            Suppressed under prefers-reduced-motion, and behind a poster of the
            same seed, exactly as the hero is. Motion beside fields somebody is
            typing into is the kind that gets a product called distracting, so
            this clip is slower and darker than the hero's. */}
        <AuthPanelVideo />

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
            {copy.site.tagline}
          </p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            {copy.site.description}
          </p>

          {/* The models actually wired up, named. Higgsfield runs a carousel of
              these beside its form and it is the most informative thing on the
              page — but every name here resolves to a model in
              services/ai/providers/replicate.ts, not to a roadmap. */}
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 border-t border-border/60 pt-5">
            {["FLUX", "Motion 1 · 720p", "Foley", "4K upscale"].map((name) => (
              <span key={name} className="text-xs text-muted-foreground">
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
