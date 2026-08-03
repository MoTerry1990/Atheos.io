import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api-guard";

import { prisma } from "@/lib/prisma";
import {
  isStorageConfigured,
  presignedDownloadUrl,
} from "@/services/storage/assets";

/**
 * Download an asset as a file.
 *
 * ## A redirect, not a proxy
 *
 * This route checks who is asking, then sends them to a presigned R2 URL that
 * carries the attachment header. It never reads the object. Streaming a 50MB
 * clip through a serverless function would cost us execution time and memory
 * to move bytes that R2 will serve for free — see `presignedDownloadUrl` for
 * why a plain link to the public URL does not work.
 *
 * ## Ownership is checked even though the bucket is public
 *
 * The public URL is unguessable, not private, so this check is not what keeps
 * an object secret. What it does is stop this route becoming a signing oracle:
 * without it, anyone signed in could mint attachment URLs for any asset id they
 * could enumerate, and a 404 for someone else's id is the same answer as for
 * one that does not exist.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Limited because this route mints signed URLs. The ownership check below
  // stops it signing someone else's object; the limit stops it being used to
  // grind through id space looking for one that is not a 404.
  const gate = await guard(request, {
    policy: "read",
    context: "GET /api/assets/[id]/download",
  });
  if (gate instanceof NextResponse) return gate;

  const user = gate.user!;

  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: "File storage is not configured." },
      { status: 503 },
    );
  }

  const asset = await prisma.asset.findFirst({
    where: { id, userId: user.id, deletedAt: null },
    select: { storageKey: true, mimeType: true, generationId: true },
  });

  if (!asset) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // A name someone can find again on their disk. `atheos-<generation>-<asset>`
  // rather than the storage key, which is a UUID under a user prefix and means
  // nothing outside our bucket.
  const extension = asset.storageKey.slice(
    asset.storageKey.lastIndexOf(".") + 1,
  );
  const filename = `atheos-${(asset.generationId ?? id).slice(-6)}-${id.slice(-6)}.${extension}`;

  const url = await presignedDownloadUrl(asset.storageKey, filename);

  // 302, not 307: this is a redirect to a different resource for a GET, and it
  // must never be cached — the signature expires in fifteen minutes.
  return NextResponse.redirect(url, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
