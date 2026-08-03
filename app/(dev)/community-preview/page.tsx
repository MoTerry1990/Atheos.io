"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Explore } from "@/features/community/components/explore";
import { PostView } from "@/features/community/components/post-view";
import { ProfileSettings } from "@/features/community/components/profile-settings";
import { ProfileView } from "@/features/community/components/profile-view";
import { CommunityApiProvider } from "@/features/community/lib/api-context";
import {
  createFixtureApi,
  type Scenario,
} from "@/app/(dev)/community-preview/fixtures";

/**
 * Community preview.
 *
 * The production components against an in-memory backend. Community is the one
 * surface whose content comes from other people, and there are none — so this
 * is the only way to see a populated gallery, a comment thread with a
 * tombstone, or a follow button that does anything.
 *
 * The **empty** scenario matters most: it is the honest production state today,
 * and the one most likely to ship without anyone having looked at it.
 *
 * `noindex` via the `(dev)` layout, and excluded from Clerk's middleware
 * matcher so the development handshake does not intercept it.
 */

const SCENARIOS: { id: Scenario; label: string; hint: string }[] = [
  { id: "populated", label: "Populated", hint: "Fictional posts and people" },
  { id: "empty", label: "Empty", hint: "What production looks like today" },
  { id: "signed-out", label: "Signed out", hint: "No viewer" },
];

const VIEWS = ["explore", "post", "profile", "settings"] as const;
type View = (typeof VIEWS)[number];

export default function CommunityPreviewPage() {
  const [scenario, setScenario] = useState<Scenario>("populated");
  const [view, setView] = useState<View>("explore");

  const [now] = useState(() => Date.now());
  // Rebuilt when the scenario changes, so each starts clean rather than
  // inheriting the last one's likes and comments.
  const [api, setApi] = useState(() => createFixtureApi(now, "populated"));

  function chooseScenario(next: Scenario) {
    setScenario(next);
    setApi(() => createFixtureApi(now, next));
  }

  const signedIn = scenario !== "signed-out";

  return (
    <CommunityApiProvider value={api}>
      <div className="min-h-dvh">
        {/* The preview route renders community *components* without the page
            wrapper that normally supplies the heading, so it had no `h1` at
            all — a screen reader's heading list opened on a section title.

            Sprint 17's E2E caught it and Sprint 13 dismissed it as a harness
            artifact. It is not: the route is real, reachable, and rendered in a
            browser more often than the real pages are. Visually hidden because
            the warning banner directly below already says what this page is. */}
        <h1 className="sr-only">Community preview</h1>
        <div className="flex flex-wrap items-center gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs">
          <p className="min-w-0">
            <span className="font-medium">Preview route.</span>{" "}
            <span className="text-muted-foreground">
              The people and posts here are fictional fixtures held in memory.
              The real gallery is empty — nobody has published anything.
            </span>
          </p>

          <div className="ml-auto flex flex-wrap items-center gap-1">
            {SCENARIOS.map((entry) => (
              <Button
                key={entry.id}
                size="xs"
                variant={scenario === entry.id ? "secondary" : "ghost"}
                onClick={() => chooseScenario(entry.id)}
                title={entry.hint}
              >
                {entry.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-border px-4 py-2">
          {VIEWS.map((entry) => (
            <Button
              key={entry}
              size="xs"
              variant={view === entry ? "secondary" : "ghost"}
              onClick={() => setView(entry)}
              className="capitalize"
            >
              {entry}
            </Button>
          ))}
        </div>

        <div className="mx-auto max-w-6xl p-4 sm:p-6">
          {/* Keyed on the scenario so switching remounts rather than merging
              state from the previous fixture. */}
          {view === "explore" ? (
            <Explore key={scenario} signedIn={signedIn} />
          ) : view === "post" ? (
            <PostView key={scenario} slug="fx1" signedIn={signedIn} />
          ) : view === "profile" ? (
            <ProfileView
              key={scenario}
              handle="fixture-ada"
              signedIn={signedIn}
            />
          ) : (
            <div className="max-w-lg">
              <ProfileSettings key={scenario} />
            </div>
          )}
        </div>
      </div>
    </CommunityApiProvider>
  );
}
