import type { DashboardData } from "@/features/dashboard/types";

/**
 * Sample dashboard data.
 *
 * Satisfies exactly the same `DashboardData` contract the real service returns,
 * which is what makes `/dashboard-preview` a genuine test of the UI rather than
 * a mock-up: it renders the production components, and if a component breaks,
 * the preview breaks with it.
 *
 * ## This is development scaffolding, not product content
 *
 * These numbers appear only on the preview route, which is `noindex` and behind
 * the dev route group. They are never shown to a user and never presented as
 * real activity — the actual dashboard queries Postgres and renders empty
 * states when there is nothing there.
 *
 * ## Timestamps are computed relative to `now`
 *
 * Hard-coded dates rot: six months from now a fixture would render "8 months
 * ago" and the relative-time formatting would stop being exercised at all.
 *
 * **This makes the function non-deterministic, and that matters.** `"use
 * client"` does not mean "browser only" — Client Components are still rendered
 * on the server for the initial HTML, so calling this during render produces
 * different millisecond values on each side and hydrates with a mismatch. An
 * earlier version of this comment claimed otherwise and was wrong; the bug it
 * caused showed up as `dateTime` attributes differing by ~1 second.
 *
 * The preview page therefore builds the fixture in an effect, after mount,
 * where only the client runs it. Do not call this during render.
 */

const minutesAgo = (n: number) =>
  new Date(Date.now() - n * 60_000).toISOString();
const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString();

export function dashboardFixture(): DashboardData {
  return {
    user: {
      displayName: "Alex Rivera",
      imageUrl: null,
      memberSince: daysAgo(96),
    },

    credits: {
      balance: 1_284,
      allowance: { credits: 3_000, kind: "monthly" as const },
      spentThisPeriod: 1_716,
      renewsAt: daysAgo(-12),
      planName: "Studio",
    },

    storage: {
      usedBytes: 7.4 * 1024 * 1024 * 1024,
      quotaBytes: 25 * 1024 * 1024 * 1024,
      breakdown: [
        { kind: "VIDEO", bytes: 5.1 * 1024 * 1024 * 1024, count: 34 },
        { kind: "IMAGE", bytes: 1.8 * 1024 * 1024 * 1024, count: 412 },
        { kind: "AUDIO", bytes: 0.5 * 1024 * 1024 * 1024, count: 61 },
      ],
    },

    projects: [
      {
        id: "p1",
        name: "Neon studies",
        assetCount: 48,
        updatedAt: minutesAgo(24),
        previewHues: [303, 262, 237, 328],
      },
      {
        id: "p2",
        name: "Product on marble",
        assetCount: 22,
        updatedAt: minutesAgo(190),
        previewHues: [25, 45, 70, 162],
      },
      {
        id: "p3",
        name: "Title sequence",
        assetCount: 9,
        updatedAt: daysAgo(2),
        previewHues: [237, 190, 280],
      },
      {
        id: "p4",
        name: "Editorial portraits",
        assetCount: 63,
        updatedAt: daysAgo(4),
        previewHues: [328, 303, 262, 25],
      },
      {
        id: "p5",
        name: "Ambient loops",
        assetCount: 15,
        updatedAt: daysAgo(6),
        previewHues: [162, 190],
      },
      {
        id: "p6",
        name: "Brand exploration",
        assetCount: 31,
        updatedAt: daysAgo(9),
        previewHues: [70, 45, 303, 237],
      },
    ],

    activity: [
      {
        id: "a1",
        type: "generation_succeeded",
        title: "Volumetric light through fog, anamorphic lens flare",
        detail: "Aurora XL",
        at: minutesAgo(6),
      },
      {
        id: "a2",
        type: "credits_spent",
        title: "24 credits spent",
        detail: "generation spend",
        at: minutesAgo(6),
      },
      {
        id: "a3",
        type: "generation_failed",
        title: "Isometric city block at dusk, orthographic",
        detail: "Nova Diffusion",
        at: minutesAgo(41),
      },
      {
        id: "a4",
        type: "credits_granted",
        title: "24 credits added",
        detail: "generation refund",
        at: minutesAgo(41),
      },
      {
        id: "a5",
        type: "asset_uploaded",
        title: "image uploaded",
        detail: null,
        at: minutesAgo(128),
      },
      {
        id: "a6",
        type: "generation_succeeded",
        title: "Liquid chrome, studio reflection, macro detail",
        detail: "Helix Video",
        at: minutesAgo(310),
      },
      {
        id: "a7",
        type: "project_created",
        title: "Title sequence",
        detail: "new project",
        at: daysAgo(2),
      },
      {
        id: "a8",
        type: "credits_granted",
        title: "3,000 credits added",
        detail: "subscription grant",
        at: daysAgo(18),
      },
    ],

    notifications: [
      {
        id: "n1",
        title: "Generation finished",
        body: "Your 4-second loop is ready in Title sequence.",
        at: minutesAgo(6),
        read: false,
        href: "/dashboard",
      },
      {
        id: "n2",
        title: "A generation failed",
        body: "Nova Diffusion rejected the prompt. 24 credits refunded.",
        at: minutesAgo(41),
        read: false,
        href: "/dashboard",
      },
      {
        id: "n3",
        title: "Storage is 30% full",
        body: "7.4GB of your 25GB quota is in use.",
        at: daysAgo(3),
        read: true,
        href: "/dashboard",
      },
    ],

    stats: {
      generationsThisPeriod: 147,
      assetsTotal: 507,
      successRate: 0.94,
    },

    pending: false,
  };
}
