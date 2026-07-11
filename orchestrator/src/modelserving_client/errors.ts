/**
 * Error types for the Model-Serving RPC client (RFC §9.2/§13). Split the
 * same way every other error module in this codebase is: a distinguishable
 * "the remote service did not answer" condition (`ModelServingUnavailableError`)
 * versus "the caller sent something malformed" (`ModelServingValidationError`)
 * versus "the frame contained no detectable face" (`ModelServingNoFaceError`)
 * — so a Bundle Adapter (Visual/Audio, M9) can map the former onto
 * `SERVICE_UNAVAILABLE` and the latter onto `NO_SIGNAL_DETECTED` (RFC §13's
 * signal-health contract), never onto a manufactured negative result.
 */

export class ModelServingUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ModelServingUnavailableError';
  }
}

export class ModelServingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelServingValidationError';
  }
}

export class ModelServingNoFaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelServingNoFaceError';
  }
}

export class ModelServingNoSpeechError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ModelServingNoSpeechError';
    this.code = code;
  }
}

export class ModelServingLivenessError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ModelServingLivenessError';
    this.code = code;
  }
}
