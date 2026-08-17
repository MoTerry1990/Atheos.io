import "server-only";

import { FAILURE_CODES, type FailureCode } from "@/services/billing/settlement";

/**
 * The stages a generation's output passes through on its way to the customer,
 * and a failure type that names which one broke.
 *
 * ## Why this exists
 *
 * Sprint 5C.2 ran one controlled production generation. Replicate succeeded and
 * returned a valid 620 KB PNG; Atheos lost it. The worker recorded
 * `{"code":"unknown"}` and nothing else, so the only honest thing the report
 * could say was "it fails somewhere between fetching the output and writing the
 * asset row". Reproducing every stage locally with production credentials
 * worked, which narrowed it to the deployed runtime and no further.
 *
 * A single `unknown` for six distinct operations is what made that
 * undiagnosable. Each stage now names itself, so the next failure says *where*.
 *
 * ## Sanitised by construction
 *
 * The provider's output URL is signed and the prompt is the customer's. Neither
 * may reach a log line, and "remember not to log the error object" is not a
 * mechanism. So `describeFailure` returns a fixed, closed shape — stage, error
 * class, code, retryability, and an HTTP status when there was one — and there
 * is no field on it that can carry a URL, a payload or a prompt. Callers log
 * that object rather than the exception.
 */

export type DeliveryStage =
  /** Reading the provider's response into `{sourceUrl, mimeType}` pairs. */
  | "provider_output_parse"
  /** Downloading the bytes from the provider. */
  | "provider_fetch"
  /** Size, declared type and magic-number checks. */
  | "content_validation"
  /** Writing the object to R2. */
  | "r2_upload"
  /** Creating the asset row and transitioning the generation. */
  | "asset_transaction"
  /** Reversing or retaining the charge. */
  | "settlement";

/**
 * A failure that knows which stage produced it.
 *
 * `cause` is deliberately **not** carried forward. The underlying error can
 * hold a signed URL in its message — `fetch` failures routinely do — and an
 * error chain is exactly the thing that ends up stringified into a log.
 */
export class DeliveryFailure extends Error {
  readonly stage: DeliveryStage;
  readonly code: FailureCode;
  readonly retryable: boolean;
  /** Provider HTTP status, when the stage had one. Never a body. */
  readonly status?: number;
  /** Class name of the original error, for diagnosis without its message. */
  readonly originalClass: string;
  /** The vendor's error code, when the original error carried one. */
  readonly vendorCode?: string;

  constructor(input: {
    stage: DeliveryStage;
    code: FailureCode;
    retryable: boolean;
    message: string;
    status?: number;
    originalClass?: string;
    vendorCode?: string;
  }) {
    // The message is one of ours, from the fixed set below — never a provider
    // string and never an interpolated URL.
    super(input.message);
    this.name = "DeliveryFailure";
    this.stage = input.stage;
    this.code = input.code;
    this.retryable = input.retryable;
    this.status = input.status;
    this.originalClass = input.originalClass ?? "DeliveryFailure";
    this.vendorCode = input.vendorCode;
  }
}

/** Exactly what may be written to a log. Nothing here can hold a secret. */
export interface SanitizedFailure {
  stage: DeliveryStage;
  code: FailureCode;
  retryable: boolean;
  errorClass: string;
  status?: number;
  /**
   * The vendor's own error code — `InvalidArgument`, `NoSuchBucket`,
   * `AccessDenied`.
   *
   * Safe because it is a fixed identifier from a published list, not a message:
   * it cannot contain a URL, a key or a prompt. Added after the first staged
   * diagnosis narrowed a delivery failure to `r2_upload` with a bare HTTP 400,
   * which named the operation but not the complaint — and 400 from an object
   * store has a dozen possible causes.
   */
  vendorCode?: string;
}

/**
 * Reduce any thrown value to the closed shape above.
 *
 * An error that is not a `DeliveryFailure` came from somewhere unanticipated,
 * and its message is therefore untrusted — it is dropped, and only the
 * constructor name survives. That name is the single most useful field for
 * diagnosis (`TypeError` and `S3ServiceException` mean very different things)
 * and it cannot contain a URL.
 */
export function describeFailure(
  error: unknown,
  fallbackStage: DeliveryStage,
): SanitizedFailure {
  if (error instanceof DeliveryFailure) {
    return {
      stage: error.stage,
      code: error.code,
      retryable: error.retryable,
      errorClass: error.originalClass,
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.vendorCode ? { vendorCode: error.vendorCode } : {}),
    };
  }

  const errorClass =
    error instanceof Error ? error.constructor.name : typeof error;

  // An AWS SDK exception carries `$metadata.httpStatusCode`, which is safe and
  // is usually the whole answer for an R2 failure (403 credentials, 404 bucket).
  const status =
    error &&
    typeof error === "object" &&
    "$metadata" in error &&
    typeof (error as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode === "number"
      ? (error as { $metadata: { httpStatusCode: number } }).$metadata
          .httpStatusCode
      : undefined;

  /**
   * An AWS/S3 exception sets `name` to the vendor's error code while the
   * constructor stays `S3ServiceException`. When they differ, `name` is the
   * specific complaint and is the field worth keeping.
   */
  const vendorCode =
    error instanceof Error && error.name && error.name !== errorClass
      ? error.name
      : undefined;

  return {
    stage: fallbackStage,
    code: FAILURE_CODES.INTERNAL_FINALIZATION_FAILED,
    // Unrecognised means unknown, and an unknown fault is worth one retry: the
    // common unrecognised failure is a transient network error.
    retryable: true,
    errorClass,
    ...(status !== undefined ? { status } : {}),
    ...(vendorCode ? { vendorCode } : {}),
  };
}

/**
 * Run one stage, converting anything it throws into a staged failure.
 *
 * Wrapping rather than try/catch at each call site is what guarantees no stage
 * can throw a bare error that loses its identity on the way up.
 */
export async function inStage<T>(
  stage: DeliveryStage,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DeliveryFailure) throw error;

    const described = describeFailure(error, stage);
    throw new DeliveryFailure({
      stage,
      code: described.code,
      retryable: described.retryable,
      message: `Delivery failed at ${stage}.`,
      status: described.status,
      originalClass: described.errorClass,
      vendorCode: described.vendorCode,
    });
  }
}
