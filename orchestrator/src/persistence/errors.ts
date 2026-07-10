/**
 * Error types for the Evidence Store persistence layer.
 *
 * Two distinct failure classes, deliberately not collapsed into one: an
 * `EvidencePersistenceValidationError` means the caller handed the
 * repository a malformed record — a programming error upstream, caught
 * before any query is issued. An `EvidenceStoreError` means the store
 * itself failed (connection refused, constraint violation, timeout, ...) —
 * an infrastructure failure the caller must handle per RFC §13's
 * degradation policy, not a validation bug. Conflating these would repeat,
 * one layer down, exactly the "detector said no vs. detector didn't
 * answer" mistake the signal-health contract (ADR-11) exists to prevent.
 */

export class EvidencePersistenceValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: readonly string[],
  ) {
    super(message);
    this.name = 'EvidencePersistenceValidationError';
  }
}

export class EvidenceStoreError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'EvidenceStoreError';
  }
}
