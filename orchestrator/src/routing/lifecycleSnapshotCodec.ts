import { z } from 'zod';

import { LIFECYCLE_STATES } from '../statemachine/index.js';
import type { LifecycleSessionRecord } from '../statemachine/index.js';

/**
 * Serializes/deserializes a `LifecycleSessionRecord` (M4) into the generic
 * JSON envelope `SessionStateSnapshot.state` (M1) already provisions:
 * "`state` is intentionally an opaque JSON payload — the Fusion Engine
 * owns its internal representation ... this package only owns the
 * durable-storage envelope around it" (`contracts/src/index.ts`). No
 * change to that schema was needed; M7 is simply the first concrete
 * payload written into it.
 *
 * Note on scope: RFC §9.3 describes snapshot content as "the log-odds
 * accumulator and Beta parameters per bundle" (i.e. Fusion Engine state).
 * This codebase's Fusion Engine (M3) is stateless per call — it
 * recomputes the posterior fresh from the persisted evidence ledger every
 * time, which RFC §9.0's own sizing envelope (a session's full evidence
 * history is small) makes cheap. The genuinely non-recomputable-from-the-
 * ledger derived state in this implementation is the Lifecycle FSM's
 * record (current state, dwell-time anchor, permanent recovery
 * annotations) — so that is what M7 snapshots and recovers.
 */
const RecoveryAnnotationSchema = z.object({
  recoveredAt: z.coerce.date(),
  regressedFromState: z.enum(LIFECYCLE_STATES),
});

const DisqualificationAnnotationSchema = z.object({
  disqualifiedAt: z.coerce.date(),
  reason: z.string(),
  previousState: z.enum(LIFECYCLE_STATES),
});

const LifecycleSnapshotStateSchema = z.object({
  state: z.enum(LIFECYCLE_STATES),
  stateEnteredAt: z.coerce.date(),
  recoveryAnnotations: z.array(RecoveryAnnotationSchema),
  disqualificationAnnotations: z.array(DisqualificationAnnotationSchema).default([]),
});

export class LifecycleSnapshotCodecError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'LifecycleSnapshotCodecError';
  }
}

/** JSON-safe (`Date` -> ISO string) so it round-trips through `JSON.stringify`/Postgres `jsonb` unchanged. */
export function serializeLifecycleSessionRecord(
  record: LifecycleSessionRecord,
): Record<string, unknown> {
  return {
    state: record.state,
    stateEnteredAt: record.stateEnteredAt.toISOString(),
    recoveryAnnotations: record.recoveryAnnotations.map((annotation) => ({
      recoveredAt: annotation.recoveredAt.toISOString(),
      regressedFromState: annotation.regressedFromState,
    })),
    disqualificationAnnotations: record.disqualificationAnnotations.map((annotation) => ({
      disqualifiedAt: annotation.disqualifiedAt.toISOString(),
      reason: annotation.reason,
      previousState: annotation.previousState,
    })),
  };
}

/**
 * The inverse of `serializeLifecycleSessionRecord`. Validated with a Zod
 * schema (matching this codebase's persistence-layer convention) rather
 * than trusted blindly — snapshot rows are durable data that may in
 * principle have been written by a different, incompatible version of
 * this codec, so malformed input is rejected loudly, not silently
 * coerced into a bogus in-memory state.
 */
export function deserializeLifecycleSessionRecord(
  state: Record<string, unknown>,
): LifecycleSessionRecord {
  try {
    return LifecycleSnapshotStateSchema.parse(state);
  } catch (error) {
    throw new LifecycleSnapshotCodecError('Malformed lifecycle session snapshot state', error);
  }
}
