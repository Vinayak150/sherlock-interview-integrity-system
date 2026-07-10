/**
 * Error types for the Model-Serving RPC client (RFC §9.2/§13). Split the
 * same way every other error module in this codebase is: a distinguishable
 * "the remote service did not answer" condition (`ModelServingUnavailableError`)
 * versus "the caller sent something malformed" (`ModelServingValidationError`)
 * — so a Bundle Adapter (Visual/Audio, M9) can map the former, and only the
 * former, onto `SERVICE_UNAVAILABLE` (RFC §13's signal-health contract),
 * never onto a manufactured negative result.
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
