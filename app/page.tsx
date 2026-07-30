import { Container } from "@/components/layout/container";

/**
 * Placeholder root route.
 *
 * Deliberately not a landing page — that is Sprint 6. This exists only so the
 * foundation has something to render, and so a broken design system is visible
 * immediately rather than at the moment the first real screen is built.
 *
 * Replace it wholesale; nothing should be salvaged from this file.
 */
export default function Home() {
  return (
    <Container
      as="main"
      size="sm"
      className="flex min-h-dvh flex-col items-center justify-center gap-6 text-center"
    >
      <p className="font-mono text-2xs tracking-wider text-muted-foreground uppercase">
        Sprint 0 · Foundation
      </p>

      <h1 className="text-gradient-brand text-4xl tracking-tighter sm:text-5xl">
        Atheos
      </h1>

      <p className="max-w-md text-balance text-muted-foreground">
        The platform foundation is in place. No product surface has been built
        yet — routing, design tokens, data model and service clients only.
      </p>
    </Container>
  );
}
