import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";
import { z } from "zod";

import { adjustCredits, getUserDetail, setRole } from "@/services/admin/users";
import { adminResponse } from "@/app/api/admin/shared";

/**
 * One account.
 *
 *   GET   the support view — audited, because it is a disclosure
 *   POST  adjust credits, or change a role
 *
 * ## The idempotency key comes from the client
 *
 * A support agent double-submitting a goodwill grant is the exact failure this
 * must not have, and only the client knows that two requests are the same
 * *intent* rather than two deliberate adjustments. The unique constraint is
 * what enforces it; this just carries the key.
 */

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("adjust-credits"),
    amount: z.number().int(),
    reason: z.string().trim().min(3).max(500),
    idempotencyKey: z.string().min(8).max(100),
  }),
  z.object({
    action: z.literal("set-role"),
    role: z.enum(["USER", "ADMIN"]),
    reason: z.string().trim().min(3).max(500),
  }),
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const gate = await guard(request, {
    policy: "admin",
    // Non-admins get 404 here, before any input is parsed — see the note on
    // `admin` in lib/api-guard.ts. `auth: "optional"` so the guard itself never
    // 401s, which would confirm the route exists.
    auth: "optional",
    admin: true,
    context: "GET /api/admin/users/[id]",
  });
  if (gate instanceof NextResponse) return gate;

  try {
    return NextResponse.json({ user: await getUserDetail(id) });
  } catch (error) {
    return adminResponse(error, "Could not load that account.");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const gate = await guard(request, {
    policy: "admin",
    // Non-admins get 404 here, before any input is parsed — see the note on
    // `admin` in lib/api-guard.ts. `auth: "optional"` so the guard itself never
    // 401s, which would confirm the route exists.
    auth: "optional",
    admin: true,
    context: "POST /api/admin/users/[id]",
  });
  if (gate instanceof NextResponse) return gate;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Malformed request body." },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "That change is not valid.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.action === "adjust-credits") {
      return NextResponse.json(
        await adjustCredits({
          userId: id,
          amount: parsed.data.amount,
          reason: parsed.data.reason,
          idempotencyKey: parsed.data.idempotencyKey,
        }),
      );
    }

    return NextResponse.json(
      await setRole({
        userId: id,
        role: parsed.data.role,
        reason: parsed.data.reason,
      }),
    );
  } catch (error) {
    return adminResponse(error, "Could not apply that change.");
  }
}
