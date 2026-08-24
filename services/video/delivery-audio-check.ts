import "server-only";

import { AUDIO_CAPABILITIES } from "@/services/ai/audio-strategy";
import { probeMp4 } from "@/services/video/container-probe";
import {
  runAudioGate,
  type AudioGateResult,
} from "@/services/video/audio-gate";

/**
 * The audio gate, on the real delivery path.
 *
 * ## The gap this closes
 *
 * `audio-gate.ts` has existed since Sprint 22 and nothing has ever called it.
 * Every judgment it can make — promised sound that never arrived, a codec we
 * cannot deliver, audio shorter than its picture — was written, tested and then
 * never reached by a single generation. A gate nothing calls is documentation.
 *
 * ## What it can and cannot decide here
 *
 * The check runs inside the serverless delivery path, on the bytes that were
 * just written to R2. There is no decoder, so this is `scope: "container"`: it
 * can prove a track's **absence** and read its format, and it cannot prove that
 * the track is anything other than silence. Loudness stays with the worker
 * phase — see `docs/DELIVERY_MEASUREMENT_SPEC.md`.
 *
 * Absence is the failure worth catching now, because it is the one that has
 * actually happened: a model sold as producing sound returning a silent file,
 * charged in full, with nothing in the pipeline positioned to notice.
 *
 * ## Fail closed, and only where a promise was made
 *
 * A model that never claimed to produce audio is not checked at all — its
 * generations pass through untouched. A model that *did* promise it and returns
 * a file with no audio track fails the generation, and the credits go back.
 */

/**
 * MP4 sample-entry formats, translated into the codec names the gate knows.
 *
 * Two vocabularies meet here. A container names its audio by four-character
 * sample-entry code — `mp4a` — while `audio-gate.ts` was written against the
 * codec names a decoder reports, where the same thing is `aac`. Handing the
 * fourCC straight through made the gate reject `mp4a` as "not supported for
 * delivery", which is every AAC file ever produced, Veo's included.
 *
 * Translating here rather than widening the gate's list keeps the gate's
 * vocabulary decoder-shaped for the worker phase, where a real decoder will
 * report these names directly.
 */
const CODEC_NAMES: Record<string, string> = {
  mp4a: "aac",
  opus: "opus",
  flac: "flac",
  alac: "alac",
  "ac-3": "ac3",
  "ec-3": "eac3",
  // Uncompressed, big- and little-endian. Both are 16-bit PCM.
  twos: "pcm_s16le",
  sowt: "pcm_s16le",
};

/**
 * The gate's name for a container's codec, or the raw code when unknown.
 *
 * An unrecognised code is passed through rather than dropped: the gate will
 * refuse it as unsupported, which is the correct outcome for a format nothing
 * in the pipeline can handle, and the log keeps the original four characters
 * for whoever has to add it.
 */
function codecName(fourCC: string | undefined): string | undefined {
  if (!fourCC) return undefined;
  return CODEC_NAMES[fourCC.toLowerCase()] ?? fourCC;
}

export interface AudioDeliveryVerdict {
  /** False stops delivery and refunds. */
  ok: boolean;
  /** Absent when the model made no audio promise. */
  gate?: AudioGateResult;
  /** Safe to log: no URLs, no prompt, no customer data. */
  detail: {
    modelId: string;
    promisedAudio: boolean;
    hasAudioStream: boolean;
    codec?: string;
    sampleRate?: number;
    channels?: number;
    audioDurationSeconds?: number;
    videoDurationSeconds?: number;
    parseError?: string;
  };
  /** Shown to the customer when `ok` is false. Never a parser message. */
  customerMessage?: string;
}

/**
 * Does this model promise sound for this generation?
 *
 * Read from `AUDIO_CAPABILITIES` rather than from what the request asked for: a
 * model with `audioAlwaysOn` promises sound whether or not the customer wanted
 * it, and a model that cannot produce audio promises nothing however the
 * request was phrased.
 */
export function promisesAudio(modelId: string, wantsSound: boolean): boolean {
  const model = AUDIO_CAPABILITIES[modelId];
  if (!model) return false;
  if (model.audioAlwaysOn) return true;
  return wantsSound && model.strategies.includes("NATIVE");
}

/**
 * Check a delivered video's audio against what its model promised.
 *
 * `bytes` are the file as stored. Passing the buffer rather than re-reading
 * from R2 is deliberate: they are the same bytes, already in memory from the
 * upload, and a second round trip would add a network failure mode to the
 * delivery path in exchange for nothing.
 */
export function checkDeliveredAudio(input: {
  modelId: string;
  mimeType: string;
  bytes: Buffer;
  /** What the customer asked for. Ignored when the model has no choice. */
  wantsSound: boolean;
  /** Requested duration, used only as a fallback for the drift check. */
  requestedDurationSeconds?: number;
}): AudioDeliveryVerdict {
  const promised = promisesAudio(input.modelId, input.wantsSound);

  /**
   * Only MP4 is parsed, so only MP4 is judged.
   *
   * A WebM from some future provider would produce a parse error, and failing a
   * generation because *our reader* does not understand its container would be
   * charging the customer for our gap. When the format is not one this can
   * read, the check abstains.
   */
  const parseable = input.mimeType.includes("mp4");

  if (!promised || !parseable) {
    return {
      ok: true,
      detail: {
        modelId: input.modelId,
        promisedAudio: promised,
        hasAudioStream: false,
        ...(promised && !parseable
          ? { parseError: `unparsed container: ${input.mimeType}` }
          : {}),
      },
    };
  }

  const probe = probeMp4(input.bytes);
  const track = probe.audioTracks[0];

  const gate = runAudioGate({
    measured: {
      scope: "container",
      hasStream: probe.hasAudioStream,
      codec: codecName(track?.codec),
      sampleRate: track?.sampleRate,
      channels: track?.channels,
      durationSeconds: track?.durationSeconds,
      // A parse failure is a decode failure as far as the gate is concerned:
      // nothing was measured, so nothing may be concluded.
      decodeError: probe.error,
    },
    promised: {
      strategy: "NATIVE",
      /**
       * The file's own picture where it has one.
       *
       * Drift is an A/V sync question. Measuring the audio against the
       * *requested* duration would fail a correctly synchronised file for the
       * video's own rounding — a model asked for 8s routinely returns 8.033.
       */
      videoDurationSeconds:
        probe.videoDurationSeconds ?? input.requestedDurationSeconds ?? 0,
      allowSpeech: true,
      allowMusic: true,
    },
  });

  return {
    ok: gate.outcome !== "fail",
    gate,
    detail: {
      modelId: input.modelId,
      promisedAudio: true,
      hasAudioStream: probe.hasAudioStream,
      // The container's own four-character code, so a log says what the file
      // actually declared rather than our translation of it.
      codec: track?.codec,
      sampleRate: track?.sampleRate,
      channels: track?.channels,
      audioDurationSeconds: track?.durationSeconds,
      videoDurationSeconds: probe.videoDurationSeconds,
      ...(probe.error ? { parseError: probe.error } : {}),
    },
    customerMessage:
      gate.outcome === "fail"
        ? /**
           * Says what is wrong with *their* video, not what our parser did.
           * "This model was supposed to deliver sound and did not" is
           * actionable; "no moov box" is not.
           */
          "This model was supposed to deliver sound and the finished video has none. You have not been charged."
        : undefined,
  };
}
