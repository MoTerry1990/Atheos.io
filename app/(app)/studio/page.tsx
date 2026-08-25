import type { Metadata } from "next";

import { StudioWorkspace } from "@/features/studio/components/studio-workspace";
import { StudioV2 } from "@/features/studio/components/v2/studio-v2";
import { toPublicModel } from "@/features/studio/lib/public-model";
import { toStudioModel } from "@/features/studio/lib/dto";
import { getCurrentUser } from "@/lib/auth";
import { listModels } from "@/services/ai/registry";
import { canUseStudioV2 } from "@/services/studio/v2-access";

export const metadata: Metadata = { title: "Studio" };

/**
 * The studio route.
 *
 * ## Which interface, decided here
 *
 * `canUseStudioV2()` requires the flag **and** an admin caller, and it runs on
 * the server. There is no `?v2=1`, no flag in a public payload and nothing a
 * browser can set: a client-readable toggle would announce that the interface
 * exists and invite attempts to reach it.
 *
 * Everyone else gets the existing Studio, unchanged. That is the point of an
 * owner beta — the stable path stays stable while an unfinished one is judged.
 *
 * ## Why the models are fetched here rather than in the client
 *
 * V2 renders the **public** contract, and building it on the server is what
 * guarantees the provider fields never reach the browser at all — not stripped
 * late, not filtered in a component somebody later edits, simply never sent.
 */
export default async function StudioPage() {
  if (!(await canUseStudioV2())) {
    return <StudioWorkspace />;
  }

  const [user, models] = await Promise.all([
    getCurrentUser(),
    Promise.resolve(listModels()),
  ]);

  return (
    <StudioV2
      models={models.map((model) => toPublicModel(toStudioModel(model)))}
      creditBalance={user?.creditBalance ?? 0}
      /**
       * Empty in Release 1.
       *
       * History belongs to the client store, which V2 does not own yet.
       * Passing an empty list renders the real empty state rather than a
       * fabricated one — a filmstrip of invented thumbnails would make the
       * shell look finished in a screenshot and lie about what works.
       */
      history={[]}
    />
  );
}
