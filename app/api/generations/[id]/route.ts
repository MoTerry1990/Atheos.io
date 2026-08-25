import { NextResponse } from "next/server";

import { guard } from "@/lib/api-guard";

import {
  GenerationError,
  cancelGeneration,
  pollGeneration,
} from "@/services/generation";
import { toGenerationDTO } from "@/features/studio/lib/dto";
import { toPublicGenerationFrom } from "@/features/studio/lib/public-model";

/**
 * A single generation.
 *
 *   GET     poll and advance it
 *   DELETE  cancel and refund
 *
 * `pollGeneration` is what actually drives a job forward: it asks the provider,
 * copies outputs into storage on success, and refunds on failure. The client
 * calling this repeatedly *is* the job runner — there is no background worker
 * yet, and pretending otherwise would mean jobs that never settle if nobody is
 * watching.
 *
 * That is a real limitation, recorded in the roadmap: a user who closes the tab
 * mid-generation leaves the job stuck at RUNNING until they return. A scheduled
 * reconciler fixes it, and belongs with the rest of the operational work.
 *
 * Both handlers scope by the signed-in user inside the service, so an id from
 * another account is a 404 rather than a leak.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // The studio polls this while a job runs, so it sits under the generous
  // `read` policy rather than `generate` — the cost here is a database read,
  // not a provider call.
  const gate = await guard(request, {
    policy: "read",
    context: "GET /api/generations/[id]",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    const generation = await pollGeneration(id);
    // Public shape here too. The poll endpoint is hit far more often than the
    // list, so leaving it un-migrated would have leaked the provider on every
    // tick while the list looked clean.
    return NextResponse.json({
      generation: toPublicGenerationFrom(toGenerationDTO(generation)),
    });
  } catch (error) {
    if (error instanceof GenerationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("generation poll failed", error);
    return NextResponse.json(
      { error: "Could not check that generation." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const gate = await guard(request, {
    policy: "mutation",
    context: "DELETE /api/generations/[id]",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    await cancelGeneration(id);
    return NextResponse.json({ status: "canceled" });
  } catch (error) {
    if (error instanceof GenerationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("generation cancel failed", error);
    return NextResponse.json(
      { error: "Could not cancel that generation." },
      { status: 500 },
    );
  }
}
