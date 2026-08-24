import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";

/**
 * **Temporary diagnostic.** Answers one question with evidence: can a decoder
 * run in the production runtime?
 *
 * The audio sprint requires decoded loudness, and the brief is explicit that a
 * decoder's availability must be *proved* rather than assumed. Guessing wrong
 * in either direction is expensive: assuming one is present ships a gate that
 * throws on every video, and assuming none is available throws away the
 * measurement for no reason.
 *
 * FFmpeg is not a candidate here and this reports why: there is no separate
 * execution environment. The "worker" is a Vercel cron calling a serverless
 * route, so everything runs in the same Node lambda, and a native binary would
 * mean an 80 MB download at every build plus an entry in the project's
 * deliberate `allowScripts` allowlist. A 400 KB WASM decoder does the same job.
 *
 * Deleted once the decision is recorded — a permanent endpoint that reads
 * arbitrary storage keys is a reconnaissance tool, which is also why it is
 * gated on `WORKER_TRIGGER_SECRET` and 404s without it, exactly as the worker
 * tick does.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(request: NextRequest): boolean {
  const secret = env.WORKER_TRIGGER_SECRET;
  if (!secret) return false;

  const header =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-worker-secret") ??
    "";

  const a = Buffer.from(header, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const started = Date.now();

  /**
   * The object to decode, as a storage key.
   *
   * A key rather than a URL: a URL from a caller is an instruction to fetch
   * whatever it likes on our credentials. The key is resolved against our own
   * bucket and nothing else.
   */
  const body = (await request.json().catch(() => ({}))) as {
    storageKey?: string;
  };
  if (!body.storageKey) {
    return NextResponse.json({ error: "storageKey required" }, { status: 400 });
  }

  try {
    const { GetObjectCommand, S3Client } = await import("@aws-sdk/client-s3");

    const client = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });

    const object = await client.send(
      new GetObjectCommand({
        Bucket: env.R2_BUCKET_NAME!,
        Key: body.storageKey,
      }),
    );
    const bytes = Buffer.from(await object.Body!.transformToByteArray());
    const fetchedMs = Date.now() - started;

    const decodeStarted = Date.now();
    const decode = (await import("audio-decode")).default;
    const audio = (await decode(bytes)) as {
      channelData: Float32Array[];
      sampleRate: number;
    };
    const decodeMs = Date.now() - decodeStarted;

    const channels = audio.channelData;
    const frames = channels[0]?.length ?? 0;

    let peak = 0;
    let sumSquares = 0;
    for (const channel of channels) {
      for (let i = 0; i < channel.length; i++) {
        const magnitude = Math.abs(channel[i]);
        if (magnitude > peak) peak = magnitude;
        sumSquares += channel[i] * channel[i];
      }
    }
    const rms = Math.sqrt(sumSquares / Math.max(frames * channels.length, 1));
    const dB = (value: number) => 20 * Math.log10(Math.max(value, 1e-12));

    return NextResponse.json({
      runtime: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      timings: { fetchedMs, decodeMs, totalMs: Date.now() - started },
      decoded: {
        ok: true,
        channels: channels.length,
        sampleRate: audio.sampleRate,
        durationSeconds: frames / audio.sampleRate,
        peakDbfs: Number(dB(peak).toFixed(2)),
        rmsDbfs: Number(dB(rms).toFixed(2)),
      },
      sizeBytes: bytes.byteLength,
    });
  } catch (error) {
    // Class name only. A fetch or S3 error message can carry a signed URL.
    return NextResponse.json(
      {
        decoded: { ok: false },
        errorClass:
          error instanceof Error ? error.constructor.name : typeof error,
        totalMs: Date.now() - started,
      },
      { status: 200 },
    );
  }
}
