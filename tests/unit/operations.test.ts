import { describe, expect, it } from "vitest";

import { OPERATION_LABELS } from "@/features/studio/lib/operation";

/**
 * The API's operation enum is a hand-written copy of `GenerationOperation`, and
 * so is the label map. Adding `text-to-audio` updated the type — which the
 * compiler enforced in two places — but **not** the zod enum on
 * `/api/generations`, because a string literal list is not type-checked against
 * anything. Every audio request from the studio was rejected with "Those
 * details are not valid" while every type in the codebase said it was fine.
 *
 * This pins the label map, which is `Record<GenerationOperation, string>` and
 * therefore exhaustive by construction. If an operation is ever added without
 * a label the compiler catches it; if the zod enum drifts from the labels this
 * catches that.
 */

// Kept in step with app/api/generations/route.ts by hand, deliberately: the
// route cannot import this (it would pull a client module into a handler), so
// the guard is a test rather than a type.
const API_ACCEPTS = [
  "text-to-image",
  "image-to-image",
  "upscale",
  "remove-background",
  "variations",
  "text-to-video",
  "image-to-video",
  "text-to-audio",
] as const;

describe("generation operations", () => {
  it("accepts every operation the studio can label", () => {
    for (const operation of Object.keys(OPERATION_LABELS)) {
      expect(API_ACCEPTS, `/api/generations rejects "${operation}"`).toContain(
        operation,
      );
    }
  });

  it("labels every operation the API accepts", () => {
    for (const operation of API_ACCEPTS) {
      expect(OPERATION_LABELS[operation]).toBeTruthy();
    }
  });
});
