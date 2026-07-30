"use client";

// This page is a Client Component for one specific reason worth understanding:
// `navSections` below contains Lucide **components**, and functions cannot be
// serialized across the server→client boundary. Passing them from a Server
// Component to `<GalleryShell>` fails at build time with "Functions cannot be
// passed directly to Client Components".
//
// Two ways out: reference icons by name and resolve them on the client, or keep
// the config on the client side of the boundary. For a documentation page that
// is interactive top to bottom, the second is simpler and costs nothing —
// there is no server rendering benefit to give up here.
//
// A real product route would take the first approach instead, so the page stays
// a Server Component. `metadata` still works: it is exported from `layout.tsx`,
// which remains a Server Component.

import {
  Bell,
  Boxes,
  LayoutGrid,
  MousePointerClick,
  Palette,
  Ruler,
  Sparkles,
  SquareStack,
  Table2,
  Tag,
  TextCursorInput,
  Type,
} from "lucide-react";

import type { NavSectionData } from "@/components/layout/nav";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/typography";
import { Stack } from "@/components/ui/stack";

import { GalleryShell } from "./gallery-shell";
import {
  BadgeSection,
  ButtonSection,
  CardSection,
  ColorSection,
  FeedbackSection,
  IconSection,
  InputSection,
  MotionSection,
  OverlaySection,
  SpacingSection,
  SurfaceSection,
  TableSection,
  TypographySection,
} from "./showcase";

/**
 * The design system gallery.
 *
 * Every component in the library, rendered live, in whichever theme is active.
 * This is the documentation — a screenshot in a markdown file is out of date the
 * moment someone edits a variant, whereas this page cannot be, because it
 * imports the real components.
 *
 * Narrative documentation lives in `docs/DESIGN-SYSTEM.md`.
 */

// Anchors rather than routes: the whole system is one scrollable page, which is
// how it actually gets used — you scan for the component you need.
const navSections: NavSectionData[] = [
  {
    title: "Foundations",
    items: [
      { href: "/design-system#typography", label: "Typography", icon: Type },
      { href: "/design-system#color", label: "Colour", icon: Palette },
      { href: "/design-system#spacing", label: "Spacing", icon: Ruler },
      {
        href: "/design-system#surfaces",
        label: "Shadows & gradients",
        icon: Sparkles,
      },
      { href: "/design-system#icons", label: "Icons", icon: Boxes },
    ],
  },
  {
    title: "Components",
    items: [
      {
        href: "/design-system#buttons",
        label: "Buttons",
        icon: MousePointerClick,
      },
      { href: "/design-system#badges", label: "Badges", icon: Tag },
      { href: "/design-system#inputs", label: "Inputs", icon: TextCursorInput },
      { href: "/design-system#cards", label: "Cards", icon: LayoutGrid },
      { href: "/design-system#overlays", label: "Overlays", icon: SquareStack },
      { href: "/design-system#tables", label: "Tables", icon: Table2 },
      { href: "/design-system#feedback", label: "Feedback", icon: Bell },
      { href: "/design-system#motion", label: "Animation", icon: Sparkles },
    ],
  },
];

export default function DesignSystemPage() {
  return (
    <GalleryShell sections={navSections}>
      {/* The aurora wash sits behind the header only — never behind body text,
          where it would eat the contrast ratio. */}
      <div className="border-b bg-aurora">
        <Container size="lg" className="py-12 sm:py-16">
          <Stack gap="md">
            <Badge variant="brand" size="sm" className="w-fit">
              Sprint 1
            </Badge>
            <Heading as="h1" size="h1" gradient className="max-w-2xl">
              Atheos Design System
            </Heading>
            <Text tone="muted" className="max-w-2xl">
              Every component in the library, rendered live. Switch the theme in
              the top bar and narrow the window — everything here is built to
              survive both.
            </Text>
          </Stack>
        </Container>
      </div>

      <Container size="lg" className="py-12">
        <TypographySection />
        <ColorSection />
        <SpacingSection />
        <SurfaceSection />
        <IconSection />
        <ButtonSection />
        <BadgeSection />
        <InputSection />
        <CardSection />
        <OverlaySection />
        <TableSection />
        <FeedbackSection />
        <MotionSection />

        <Text size="sm" tone="muted">
          Narrative documentation, usage rules and the decisions behind these
          components are in{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            docs/DESIGN-SYSTEM.md
          </code>
          .
        </Text>
      </Container>
    </GalleryShell>
  );
}
