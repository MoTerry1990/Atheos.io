/**
 * Does this MP4 actually contain an audio track?
 *
 * ## Why a hand-written box walker rather than ffmpeg or mp4box
 *
 * ffmpeg is not available: this runs inside a serverless function with no
 * binary to spawn and a bundle budget that a static build would eat several
 * times over. A library would work, but the question being asked is small and
 * completely specified by ISO/IEC 14496-12 — walk the box tree, find each
 * `trak`, read its handler type — and the parser below is shorter than the
 * dependency's own type definitions.
 *
 * The scope is deliberately narrow. This answers **"is there an audio track,
 * and what is it"** from the container's own index. It does not decode a single
 * sample, so it cannot tell you whether that track is silence. That distinction
 * is the whole reason `MeasuredAudio.scope` exists — see `audio-gate.ts`.
 *
 * ## Failing to parse is not the same as finding nothing
 *
 * A truncated file, a fragmented MP4 with no `moov`, or a WebM would all yield
 * "no audio tracks" from a naive reader, and that answer would be indis-
 * tinguishable from a genuinely silent file. Every one of those returns an
 * `error` instead, which the gate treats as a failure rather than as evidence
 * of absence. Fail closed means never inferring a negative from a parse that
 * did not happen.
 */

export interface AudioTrackInfo {
  /** The `stsd` sample-entry format: `mp4a`, `Opus`, `ac-3`. */
  codec: string;
  /** Hz, from the sample entry. */
  sampleRate?: number;
  channels?: number;
  /** Track duration in seconds, from `mdhd` timescale and duration. */
  durationSeconds?: number;
  /**
   * Average encoded data rate, kbps, from the sample-size table.
   *
   * A weak but genuinely free signal about whether the track carries anything.
   * The container indexes every frame's byte length, so summing `stsz` and
   * dividing by the duration costs one pass over a table already in memory —
   * no decoder, no samples touched.
   *
   * A real 8-second stereo render measured 256 kbps. AAC encoding pure digital
   * silence collapses to near-minimum frames, one or two orders of magnitude
   * below that. It is **not** proof of audibility: a track can carry a healthy
   * bitrate of room tone nobody can hear, and only a loudness measurement
   * settles that. See `docs/DELIVERY_MEASUREMENT_SPEC.md`.
   */
  dataRateKbps?: number;
}

export interface ContainerProbe {
  /** True only when a `soun` track was found and read. */
  hasAudioStream: boolean;
  audioTracks: AudioTrackInfo[];
  videoTrackCount: number;
  /**
   * Duration of the longest video track, seconds.
   *
   * Reported so the gate can check A/V drift against the file's *own* picture
   * rather than against the duration that was requested. A model asked for 8
   * seconds routinely returns 8.033; comparing its audio to the request would
   * fail a perfectly synchronised file for the video's rounding.
   */
  videoDurationSeconds?: number;
  /** Set when the container could not be read. Never combined with a `false`
   *  `hasAudioStream` as though it meant silence. */
  error?: string;
}

/** ISO base media file format: `size(4) type(4)`, or a 64-bit size when 1. */
const HEADER_BYTES = 8;

/**
 * Read the box tree and report the tracks.
 *
 * Synchronous and allocation-free apart from the returned objects: it reads
 * through a buffer that is already in memory because it was just uploaded, so
 * there is no reason for it to be async or to copy.
 */
export function probeMp4(bytes: Buffer): ContainerProbe {
  const empty: ContainerProbe = {
    hasAudioStream: false,
    audioTracks: [],
    videoTrackCount: 0,
  };

  try {
    if (bytes.byteLength < 16) {
      return { ...empty, error: "file is too small to be an MP4" };
    }

    /**
     * `ftyp` should be first, but a leading `styp`/`free`/`skip` is legal and
     * some encoders emit one. Rather than insisting on position, the top-level
     * scan below simply has to find a `moov` — which is the only box this
     * function needs and the one whose absence is decisive.
     */
    const top = readBoxes(bytes, 0, bytes.byteLength);
    if (top.error) return { ...empty, error: top.error };

    const moov = top.boxes.find((box) => box.type === "moov");
    if (!moov) {
      /**
       * No movie box. Either the file is fragmented with its index elsewhere,
       * or it is not an MP4, or the download was truncated. All three are
       * "cannot tell", not "no audio".
       */
      return {
        ...empty,
        error: "no moov box — the container index is missing or unreadable",
      };
    }

    const audioTracks: AudioTrackInfo[] = [];
    let videoTrackCount = 0;
    let videoDurationSeconds: number | undefined;

    const moovChildren = readBoxes(bytes, moov.start, moov.end);
    if (moovChildren.error) return { ...empty, error: moovChildren.error };

    for (const trak of moovChildren.boxes.filter((b) => b.type === "trak")) {
      const mdia = findChild(bytes, trak, "mdia");
      if (!mdia) continue;

      const hdlr = findChild(bytes, mdia, "hdlr");
      if (!hdlr) continue;

      // `hdlr`: version(1) flags(3) pre_defined(4) handler_type(4)
      if (hdlr.end - hdlr.start < 12) continue;
      const handler = bytes.toString("latin1", hdlr.start + 8, hdlr.start + 12);

      if (handler === "vide") {
        videoTrackCount++;
        const seconds = readTrackDuration(bytes, mdia);
        if (seconds !== undefined) {
          videoDurationSeconds = Math.max(videoDurationSeconds ?? 0, seconds);
        }
        continue;
      }
      if (handler !== "soun") continue;

      audioTracks.push(readAudioTrack(bytes, mdia));
    }

    return {
      hasAudioStream: audioTracks.length > 0,
      audioTracks,
      videoTrackCount,
      ...(videoDurationSeconds !== undefined ? { videoDurationSeconds } : {}),
    };
  } catch (error) {
    /**
     * A malformed box can drive any parser off the end of a buffer. Catching
     * here rather than letting it propagate keeps a corrupt file from taking
     * down delivery — and the caller still learns nothing was measured.
     */
    return {
      ...empty,
      error: `container parse failed: ${
        error instanceof Error ? error.constructor.name : typeof error
      }`,
    };
  }
}

interface Box {
  type: string;
  /** First byte of the payload. */
  start: number;
  /** One past the last byte of the payload. */
  end: number;
}

/**
 * Read the boxes between two offsets.
 *
 * Every advance is validated against the enclosing range. A box claiming a size
 * larger than its parent, or a size of zero, ends the scan with an error rather
 * than looping forever or reading past the buffer — both of which are what a
 * hostile or truncated file produces.
 */
function readBoxes(
  bytes: Buffer,
  from: number,
  to: number,
): { boxes: Box[]; error?: string } {
  const boxes: Box[] = [];
  let offset = from;

  while (offset + HEADER_BYTES <= to) {
    let size = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    let headerSize = HEADER_BYTES;

    if (size === 1) {
      // 64-bit size follows the type.
      if (offset + 16 > to) return { boxes, error: "truncated large box" };
      const large = bytes.readBigUInt64BE(offset + 8);
      // Beyond 2^53 the arithmetic below stops being exact, and no legitimate
      // box is remotely that large.
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) {
        return { boxes, error: "implausible box size" };
      }
      size = Number(large);
      headerSize = 16;
    } else if (size === 0) {
      // "Extends to end of file" — legal, and only for the last box.
      size = to - offset;
    }

    if (size < headerSize || offset + size > to) {
      return { boxes, error: `box ${type} overruns its parent` };
    }

    boxes.push({
      type,
      start: offset + headerSize,
      end: offset + size,
    });

    offset += size;
  }

  return { boxes };
}

/** The first child of `parent` with this type. */
function findChild(bytes: Buffer, parent: Box, type: string): Box | undefined {
  const { boxes } = readBoxes(bytes, parent.start, parent.end);
  return boxes.find((box) => box.type === type);
}

/**
 * A track's duration in seconds, from its `mdhd`.
 *
 * Returns undefined rather than zero when the header is short or the timescale
 * is zero. A duration of 0 would read as a real measurement and fail a drift
 * check that was never actually performed.
 */
function readTrackDuration(bytes: Buffer, mdia: Box): number | undefined {
  const mdhd = findChild(bytes, mdia, "mdhd");
  if (!mdhd || mdhd.end - mdhd.start < 20) return undefined;

  const version = bytes.readUInt8(mdhd.start);
  // v0: creation(4) modification(4) timescale(4) duration(4)
  // v1: creation(8) modification(8) timescale(4) duration(8)
  const base = mdhd.start + 4;

  if (version === 1) {
    if (mdhd.end - mdhd.start < 36) return undefined;
    const timescale = bytes.readUInt32BE(base + 16);
    const duration = bytes.readBigUInt64BE(base + 20);
    return timescale > 0 ? Number(duration) / timescale : undefined;
  }

  if (version === 0) {
    const timescale = bytes.readUInt32BE(base + 8);
    const duration = bytes.readUInt32BE(base + 12);
    return timescale > 0 ? duration / timescale : undefined;
  }

  return undefined;
}

/**
 * Total encoded bytes across every sample, from `stsz`.
 *
 * `stsz` carries either one uniform size for all samples, or a table of
 * per-sample sizes. Both forms are handled; anything else returns undefined
 * rather than a partial sum, because a data rate computed from half a table
 * would understate and could only ever produce a false alarm.
 */
function totalSampleBytes(bytes: Buffer, stbl: Box): number | undefined {
  const stsz = findChild(bytes, stbl, "stsz");
  if (!stsz || stsz.end - stsz.start < 12) return undefined;

  // `stsz`: version(1) flags(3) sample_size(4) sample_count(4) [sizes(4n)]
  const uniform = bytes.readUInt32BE(stsz.start + 4);
  const count = bytes.readUInt32BE(stsz.start + 8);
  if (count === 0) return undefined;

  if (uniform > 0) return uniform * count;

  const tableEnd = stsz.start + 12 + count * 4;
  if (tableEnd > stsz.end) return undefined;

  let total = 0;
  for (let i = 0; i < count; i++) {
    total += bytes.readUInt32BE(stsz.start + 12 + i * 4);
  }
  return total;
}

/** Codec, sample rate, channels and duration for one `soun` track. */
function readAudioTrack(bytes: Buffer, mdia: Box): AudioTrackInfo {
  const track: AudioTrackInfo = { codec: "unknown" };

  // --- Duration, from the media header ---------------------------------
  track.durationSeconds = readTrackDuration(bytes, mdia);

  // --- Data rate, from the sample-size table ----------------------------
  const stblForSizes = (() => {
    const minf = findChild(bytes, mdia, "minf");
    return minf ? findChild(bytes, minf, "stbl") : undefined;
  })();

  if (stblForSizes && track.durationSeconds && track.durationSeconds > 0) {
    const total = totalSampleBytes(bytes, stblForSizes);
    if (total !== undefined) {
      track.dataRateKbps = (total * 8) / track.durationSeconds / 1000;
    }
  }

  // --- Codec and format, from the sample description --------------------
  const minf = findChild(bytes, mdia, "minf");
  const stbl = minf && findChild(bytes, minf, "stbl");
  const stsd = stbl && findChild(bytes, stbl, "stsd");
  if (!stsd) return track;

  // `stsd`: version(1) flags(3) entry_count(4), then sample entries.
  const entryStart = stsd.start + 8;
  if (entryStart + HEADER_BYTES > stsd.end) return track;

  const entrySize = bytes.readUInt32BE(entryStart);
  track.codec = bytes.toString("latin1", entryStart + 4, entryStart + 8);

  /**
   * `AudioSampleEntry`, measured from the end of the 8-byte box header:
   *
   *   +0   reserved(6) data_reference_index(2)   — SampleEntry
   *   +8   version(2) revision(2) vendor(4)
   *   +16  channelcount(2)
   *   +18  samplesize(2)
   *   +20  pre_defined(2) reserved(2)
   *   +24  samplerate(4, 16.16 fixed point)
   *
   * The rate's low 16 bits are a fraction that is always zero in practice, so
   * the high half is the value — which is why it is read as a 16-bit integer at
   * +24 rather than shifted out of a 32-bit one.
   *
   * These offsets were wrong by eight bytes in the first version: channels was
   * read at +8 and the rate at +16, which lands in the version/revision fields.
   * A real Veo file reported `sampleRate: 2`, the gate refused it for being
   * below 44100, and a correct generation was failed and refunded. The unit
   * fixtures did not catch it because they were built at the same wrong
   * offsets — a fixture that shares the parser's assumption tests nothing. The
   * regression test now uses a real `moov` from that file.
   */
  const body = entryStart + HEADER_BYTES;
  if (entrySize >= 36 && body + 28 <= stsd.end) {
    const channels = bytes.readUInt16BE(body + 16);
    const sampleRate = bytes.readUInt16BE(body + 24);

    /**
     * Reported only when plausible.
     *
     * A zero here means the field was not where this layout expects it — some
     * entries (Opus, and v1/v2 QuickTime sound entries) carry the real rate
     * further in. Passing a zero forward would make the gate fail the file for
     * "sample rate 0", which reads as a measurement when it is a parse miss.
     * Absent is the honest answer, and the gate skips a check it has no value
     * for.
     */
    if (channels > 0) track.channels = channels;
    if (sampleRate > 0) track.sampleRate = sampleRate;
  }

  return track;
}
