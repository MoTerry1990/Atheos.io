import type { Metadata } from "next";

import { Explore } from "@/features/community/components/explore";
import { getUserId } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Explore",
  description:
    "Published work from the Atheos community — images, video and the prompts behind them.",
};

/**
 * Explore.
 *
 * Public. `getUserId` here decides whether the like and follow controls act or
 * prompt for sign-in; it does not gate the page. Passing it down as a prop
 * rather than reading Clerk in the client component keeps the gallery a pure
 * function of its inputs, which is what makes the preview route possible.
 */
export default async function ExplorePage() {
  const userId = await getUserId();

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Explore</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Work people chose to publish. Nothing here is public by default.
        </p>
      </header>

      <Explore signedIn={Boolean(userId)} />
    </>
  );
}
