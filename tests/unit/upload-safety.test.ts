import { describe, expect, it } from "vitest";

import {
  MAX_UPLOAD_BYTES,
  UPLOAD_MIME_TYPES,
  sniffImageMime,
} from "@/services/storage/assets";

/**
 * Upload validation, which guards a **public** bucket.
 *
 * The declared `file.type` in a multipart upload is attacker-controlled, so the
 * allowlist alone checks a string the attacker chose. Magic-byte sniffing is
 * what makes a stored object's extension and content agree — and that matters
 * because a file that is really HTML, served from our storage origin with a
 * sniffable type, is stored XSS.
 */

const png = (extra = 8) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(extra),
  ]);

const jpeg = () =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16)]);

const webp = () => {
  const b = Buffer.alloc(20);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(12, 4);
  b.write("WEBP", 8, "ascii");
  return b;
};

describe("sniffImageMime", () => {
  it("recognises PNG", () => {
    expect(sniffImageMime(png())).toBe("image/png");
  });

  it("recognises JPEG", () => {
    expect(sniffImageMime(jpeg())).toBe("image/jpeg");
  });

  it("recognises WebP through the RIFF container", () => {
    expect(sniffImageMime(webp())).toBe("image/webp");
  });

  it("rejects HTML claiming to be an image", () => {
    // The attack: upload `<script>` as `evil.png` with `Content-Type:
    // image/png`. The allowlist passes it; only the bytes give it away.
    expect(
      sniffImageMime(Buffer.from("<html><script>alert(1)</script>")),
    ).toBeNull();
  });

  it("rejects an SVG", () => {
    // SVG is an image and also a script host. It is deliberately not in the
    // allowlist, and the sniffer must not quietly readmit it.
    expect(
      sniffImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')),
    ).toBeNull();
    expect(UPLOAD_MIME_TYPES.has("image/svg+xml")).toBe(false);
  });

  it("rejects a GIF, which is an image we do not accept", () => {
    expect(
      sniffImageMime(Buffer.from("GIF89a...............", "ascii")),
    ).toBeNull();
  });

  it("rejects a PDF", () => {
    expect(
      sniffImageMime(Buffer.from("%PDF-1.7\n................")),
    ).toBeNull();
  });

  it("rejects a buffer too short to hold a signature", () => {
    // Must not read past the end and must not guess.
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
    expect(sniffImageMime(Buffer.from([0x89, 0x50]))).toBeNull();
  });

  it("rejects a near-miss PNG signature", () => {
    const nearly = png();
    nearly[7] = 0x00; // corrupt the final byte
    expect(sniffImageMime(nearly)).toBeNull();
  });

  it("rejects a RIFF container that is not WebP", () => {
    // A WAV file is also RIFF. Checking only the first four bytes would let it
    // through as an image.
    const wav = Buffer.alloc(20);
    wav.write("RIFF", 0, "ascii");
    wav.write("WAVE", 8, "ascii");
    expect(sniffImageMime(wav)).toBeNull();
  });
});

describe("upload policy", () => {
  it("allows exactly PNG, JPEG and WebP", () => {
    expect([...UPLOAD_MIME_TYPES].sort()).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });

  it("caps uploads at 10MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });

  it("agrees with what the sniffer can recognise", () => {
    // If the allowlist and the sniffer ever disagree, one of two things breaks:
    // a permitted type is rejected as a mismatch, or a type nobody vetted is
    // accepted. The route compares them directly, so they must stay in step.
    for (const [bytes, mime] of [
      [png(), "image/png"],
      [jpeg(), "image/jpeg"],
      [webp(), "image/webp"],
    ] as const) {
      expect(UPLOAD_MIME_TYPES.has(mime)).toBe(true);
      expect(sniffImageMime(bytes)).toBe(mime);
    }
  });
});
