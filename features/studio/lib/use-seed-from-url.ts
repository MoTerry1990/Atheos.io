"use client";

import { useEffect, useRef } from "react";

import { useStudioStore } from "@/store/studio-store";

/**
 * Pick up the prompt somebody typed on the homepage.
 *
 * The landing composer carries `?prompt=…&modality=…` through Clerk's
 * `redirect_url` and into the studio. Without this hook the studio ignores
 * both, the field is empty on arrival, and the composer's promise — *"your
 * prompt comes with you"* — is a line of marketing copy that the product
 * contradicts thirty seconds later.
 *
 * ## Why `window.location` and not `useSearchParams`
 *
 * `useSearchParams` forces the nearest Suspense boundary to opt the whole route
 * out of static rendering, and the studio is a large client tree to hold behind
 * one. This runs in an effect, after mount, on the client only — where
 * `window.location` is exactly as correct and costs nothing.
 *
 * ## It runs once, and only into an empty field
 *
 * `seeded` guards re-entry: the store rehydrates from localStorage and the
 * models list arrives asynchronously, so this effect can fire more than once.
 * Overwriting a prompt somebody has started editing, because a re-render
 * happened to re-read the URL, would be worse than not seeding at all.
 */
export function useSeedFromUrl() {
  const models = useStudioStore((state) => state.models);
  const setParam = useStudioStore((state) => state.setParam);
  const setModel = useStudioStore((state) => state.setModel);

  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current) return;

    // Models arrive from the API. Seeding a modality before they land would
    // find nothing to select.
    if (models.length === 0) return;

    const params = new URLSearchParams(window.location.search);
    const prompt = params.get("prompt");
    const modality = params.get("modality");

    if (!prompt && !modality) return;
    seeded.current = true;

    if (prompt) {
      // Bounded here as well as on the server: this value came from a URL, and
      // a caller can put anything in one.
      setParam("prompt", prompt.slice(0, 2000));
    }

    if (modality === "video" || modality === "image") {
      const wanted = modality === "video" ? "VIDEO" : "IMAGE";
      const match = models.find((model) => model.modality === wanted);
      if (match) setModel(match.id);
    }

    // Clear the query string once consumed. A reload should not re-seed over
    // whatever the user has since typed, and the prompt does not belong in a
    // URL they might paste to somebody.
    window.history.replaceState({}, "", window.location.pathname);
  }, [models, setParam, setModel]);
}
