import { NextResponse, type NextRequest } from "next/server";

import { guard, withHeaders } from "@/lib/api-guard";
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_MIME_TYPES,
  isStorageConfigured,
  sniffImageMime,
  storeUploadedAsset,
} from "@/services/storage/assets";
import { prisma } from "@/lib/prisma";

/**
 * Reference image uploads.
 *
 * ## Why this route exists
 *
 * Until Sprint 7 references lived only in the browser as object URLs, because
 * nothing consumed them. Image-to-image and image-to-video both need a URL the
 * *provider* can fetch, and an object URL is meaningless outside the tab that
 * created it. So the file has to reach our storage before a generation that
 * uses it can be submitted.
 *
 * ## Multipart, not base64 JSON
 *
 * A 10MB JPEG becomes ~13MB of base64, and Next's body parser has to hold all
 * of it as a string before we see a byte. `FormData` streams and keeps the
 * limit meaningful.
 *
 * ## What is enforced here
 *
 * Signed in, rate limited, storage configured, one file, and a type/size the
 * storage layer accepts. The composer checks type and size too — that is for
 * the instant error message, not for safety. This is the check that counts,
 * because the composer is code we handed to the caller.
 *
 * ## Every check happens before the bytes are read
 *
 * This route used to call `Buffer.from(await file.arrayBuffer())` and hand the
 * result to `storeUploadedAsset`, which enforced the 10MB limit. The limit was
 * real but it was enforced *after* the whole file had been pulled into memory —
 * so a 2GB upload was a memory-exhaustion attack that our own size check
 * politely rejected once it was too late.
 *
 * Now: `Content-Length` is checked before the multipart parser runs, `file.size`
 * before the buffer is allocated, and the declared type before either. Only a
 * request that has already passed all three gets read.
 *
 * ## The declared MIME type is a claim, not a fact
 *
 * `file.type` comes from the browser and an attacker writes it directly. A file
 * claiming `image/png` can hold anything, so after buffering we sniff the magic
 * bytes and require them to agree. Without that, the allowlist checks a string
 * the attacker chose.
 */

// The upload is a network+R2 round trip for up to 10MB, which is longer than
// the default budget on the smallest deployment tiers.
export const maxDuration = 30;

/**
 * Multipart framing — boundaries, headers, the trailing delimiter — adds a
 * little to the wire size of a 10MB file. Allowing 1KB of slack means a
 * legitimate upload at exactly the limit is not rejected by the pre-parse
 * check, while anything wildly over is still refused before parsing.
 */
const MULTIPART_OVERHEAD_ALLOWANCE = 1024;

export async function POST(request: NextRequest) {
  const gate = await guard(request, {
    policy: "upload",
    // No `body` schema: this is multipart, not JSON. The guard still applies
    // auth, the rate limit and the cross-origin check; the file itself is
    // validated below, where its shape can actually be inspected.
    context: "POST /api/uploads",
  });
  if (gate instanceof NextResponse) return gate;
  const user = gate.user!;

  if (!isStorageConfigured()) {
    return NextResponse.json(
      {
        error:
          "File storage is not configured, so references cannot be uploaded.",
        code: "storage_unconfigured",
      },
      { status: 503 },
    );
  }

  // Before the parser: a declared length over the ceiling is refused without
  // reading a byte of the body.
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_ALLOWANCE) {
    return NextResponse.json(
      {
        error: "That file is too large. The limit is 10MB.",
        code: "too_large",
      },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "That upload was malformed." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "No file was included." },
      { status: 400 },
    );
  }

  // Type and size before `arrayBuffer()`, so a rejected upload never occupies
  // memory proportional to its size.
  if (!UPLOAD_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      {
        error: "That file type is not supported. Use PNG, JPEG or WebP.",
        code: "unsupported_type",
      },
      { status: 415 },
    );
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: "That file is too large. The limit is 10MB.",
        code: "too_large",
      },
      { status: 413 },
    );
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());

    // The declared type got us this far; the actual bytes have to agree with
    // it. A PNG header is not forgeable by renaming a file.
    const sniffed = sniffImageMime(bytes);
    if (!sniffed || sniffed !== file.type) {
      return NextResponse.json(
        {
          error: "That file does not look like the image type it claims to be.",
          code: "type_mismatch",
        },
        { status: 415 },
      );
    }

    const stored = await storeUploadedAsset({
      userId: user.id,
      bytes,
      mimeType: sniffed,
    });

    // Recorded as an asset so it counts toward the user's storage, appears in
    // their library, and is covered by an account deletion. A file in the
    // bucket that no row knows about is a file nobody can ever delete.
    const asset = await prisma.asset.create({
      data: {
        userId: user.id,
        kind: "IMAGE",
        source: "UPLOADED",
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
      },
      select: { id: true },
    });

    return withHeaders(
      NextResponse.json(
        { assetId: asset.id, storageKey: stored.storageKey, url: stored.url },
        { status: 201 },
      ),
      gate,
    );
  } catch (error) {
    // The storage layer throws on an unsupported type or an oversized file.
    // Those are the caller's fault and the message is safe to show; anything
    // else is ours and is not.
    const message = error instanceof Error ? error.message : "";
    const isClientFault =
      message.startsWith("Unsupported upload type") ||
      message.startsWith("The uploaded file was");

    if (!isClientFault) console.error("upload failed", error);

    return NextResponse.json(
      {
        error: isClientFault
          ? "That file could not be accepted. Use a JPEG, PNG or WebP under 10MB."
          : "The upload failed. Try again.",
      },
      { status: isClientFault ? 400 : 500 },
    );
  }
}
