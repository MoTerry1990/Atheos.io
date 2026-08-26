import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Atheos stores what the provider produced. Byte for byte.
 *
 * ## Why this needs a test rather than a comment
 *
 * Veo output carries SynthID in the frames and a C2PA manifest in the
 * container. Those are how a viewer can tell a clip is synthetic, and the
 * policy record treats preserving them as an obligation rather than a nicety.
 *
 * "We do not transcode" is easy to believe and easy to break. Somebody adds a
 * thumbnail step, a normalisation pass, a metadata strip "for privacy", or
 * swaps the upload for a stream that re-chunks — and the manifest is gone with
 * no test failing. The property worth pinning is not *how* the file is
 * handled but that the SHA-256 going in equals the SHA-256 going out.
 *
 * ## The fixture
 *
 * A real MP4 box layout: `ftyp` so the content sniffer recognises it, then a
 * `uuid` box, which is exactly where a C2PA manifest lives in an ISO-BMFF
 * file. The manifest bytes are a recognisable marker, so a test that fails can
 * say whether the file was truncated, re-encoded or stripped.
 */

const putBodies: Buffer[] = [];

/**
 * Mocked at the R2 boundary rather than at the AWS SDK.
 *
 * `lib/r2` is the seam this module actually depends on, and intercepting the
 * SDK underneath it would leave the real credential validation running — a
 * test that fails for want of a bucket name proves nothing about bytes.
 */
vi.mock("@/lib/r2", () => ({
  r2Client: () => ({
    send: (command: { input?: { Body?: Buffer } }) => {
      const body = command.input?.Body;
      if (body) putBodies.push(Buffer.from(body));
      return Promise.resolve({});
    },
  }),
  r2Bucket: () => "test-bucket",
  r2PublicUrl: (key: string) => `https://cdn.example.test/${key}`,
  r2ConfigProblems: () => [],
}));

vi.mock("@aws-sdk/client-s3", () => ({
  PutObjectCommand: class {
    constructor(readonly input: { Body: Buffer }) {}
  },
  GetObjectCommand: class {
    constructor(readonly input: unknown) {}
  },
  S3Client: class {},
}));

const { storeGeneratedAsset } = await import("@/services/storage/assets");

/** An ISO-BMFF box: 4-byte big-endian length, 4-byte type, payload. */
function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, payload]);
}

/**
 * The C2PA box UUID from the specification. Using the real one matters: a
 * pipeline that strips "unknown" boxes would keep an invented UUID and drop
 * this one, and the test would pass while the product broke.
 */
const C2PA_UUID = Buffer.from("d8fec3d61b0e483c92975828877ec481", "hex");

const MANIFEST = Buffer.from(
  "jumbc2pa-manifest:synthid=present;generator=veo-3.1",
  "utf8",
);

function veoLikeMp4(): Buffer {
  return Buffer.concat([
    box("ftyp", Buffer.from("isomiso2avc1mp41", "ascii")),
    box("uuid", Buffer.concat([C2PA_UUID, MANIFEST])),
    // Stand-in for media data. Its content is irrelevant; its survival is not.
    box("mdat", Buffer.alloc(2048, 0x7f)),
  ]);
}

const FIXTURE = veoLikeMp4();
const FIXTURE_SHA256 = createHash("sha256").update(FIXTURE).digest("hex");

beforeEach(() => {
  putBodies.length = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "video/mp4" }),
      arrayBuffer: async () =>
        FIXTURE.buffer.slice(
          FIXTURE.byteOffset,
          FIXTURE.byteOffset + FIXTURE.byteLength,
        ),
    })),
  );
});

const store = () =>
  storeGeneratedAsset({
    userId: "user_1",
    generationId: "gen_1",
    sourceUrl: "https://provider.example.test/output.mp4",
    mimeType: "video/mp4",
  });

describe("stored bytes are the provider's bytes", () => {
  it("uploads a file with the identical SHA-256", async () => {
    // The whole claim, in one assertion.
    await store();

    expect(putBodies).toHaveLength(1);
    expect(createHash("sha256").update(putBodies[0]!).digest("hex")).toBe(
      FIXTURE_SHA256,
    );
  });

  it("reports that same hash as the asset checksum", async () => {
    /**
     * The checksum is not merely a record — it is part of the storage key, so
     * a mismatch here would mean the file is filed under a name that does not
     * describe it, and retries would stop being idempotent.
     */
    const asset = await store();

    expect(asset.checksum).toBe(FIXTURE_SHA256);
    expect(asset.sizeBytes).toBe(FIXTURE.byteLength);
  });

  it("does not transcode: the byte length is unchanged", async () => {
    await store();
    expect(putBodies[0]!.byteLength).toBe(FIXTURE.byteLength);
  });

  it("keeps the C2PA manifest box intact", async () => {
    /**
     * Asserted by locating the real spec UUID rather than by searching for the
     * payload, because a stripper that removes provenance boxes would take the
     * UUID with it — and a substring search for the manifest text alone could
     * pass on a file where the box header had been mangled.
     */
    await store();
    const stored = putBodies[0]!;

    const uuidAt = stored.indexOf(C2PA_UUID);
    expect(uuidAt).toBeGreaterThan(-1);
    expect(
      stored.subarray(
        uuidAt + C2PA_UUID.length,
        uuidAt + C2PA_UUID.length + MANIFEST.length,
      ),
    ).toEqual(MANIFEST);
  });

  it("keeps the SynthID marker", async () => {
    await store();
    expect(putBodies[0]!.includes(Buffer.from("synthid=present"))).toBe(true);
  });

  it("preserves box structure, so nothing was remuxed", async () => {
    /**
     * A remux that happened to produce the same length would still reorder or
     * rewrite boxes. Checking the declared length of the first box against the
     * file catches that where a hash comparison alone would not explain it.
     */
    await store();
    const stored = putBodies[0]!;

    expect(stored.subarray(4, 8).toString("ascii")).toBe("ftyp");
    expect(stored.readUInt32BE(0)).toBe(FIXTURE.readUInt32BE(0));
    expect(stored.equals(FIXTURE)).toBe(true);
  });
});
