import type { LifecycleState } from '../statemachine/index.js';

/**
 * Adaptive sampling cadence (RFC §12): "Sampling cadence increases when a
 * session's confidence is borderline or unstable — where marginal
 * evidence value is highest — and decreases when it is stable and high.
 * This is simultaneously a cost control and a detection-quality
 * improvement." A pure function of the session's current posterior/state
 * — no I/O, no model-serving dependency itself, trivially unit-testable,
 * matching this codebase's established pattern for "core math" modules.
 */

/** RFC §12: the stable-and-high end of the range — infrequent GPU-bound calls once a session is confidently resolved. */
export const DEFAULT_STABLE_INTERVAL_MS = 30_000;
/** RFC §12: the borderline/unstable end — frequent calls exactly where marginal evidence value is highest. */
export const DEFAULT_BORDERLINE_INTERVAL_MS = 2_000;
/** The default cadence for ordinary, unremarkable operation. */
export const DEFAULT_BASELINE_INTERVAL_MS = 10_000;

/** A credible-interval width at or below this, alongside a stable/high-confidence state, counts as "stable" for cadence purposes. Deliberately independent of `decision/`'s own ambiguity-band constants (this module sits architecturally below `decision/`, consumed by Bundle Adapters, and must not depend on it). */
export const DEFAULT_STABLE_MAX_INTERVAL_WIDTH = 0.15;
/** A credible-interval width at or above this counts as "unstable" (sparse or contradictory evidence), regardless of state. */
export const DEFAULT_UNSTABLE_MIN_INTERVAL_WIDTH = 0.4;

const STABLE_STATES: ReadonlySet<LifecycleState> = new Set(['HIGHLY_CONFIDENT', 'CONFIRMED']);
const BORDERLINE_STATES: ReadonlySet<LifecycleState> = new Set([
  'LOST_CONFIDENCE',
  'DISQUALIFIED',
  'RECOVERED',
]);

export interface SamplingCadenceInput {
  readonly lifecycleState: LifecycleState;
  readonly probability: number;
  readonly credibleIntervalWidth: number;
}

export interface SamplingCadenceOptions {
  readonly stableIntervalMs?: number;
  readonly borderlineIntervalMs?: number;
  readonly baselineIntervalMs?: number;
  readonly stableMaxIntervalWidth?: number;
  readonly unstableMinIntervalWidth?: number;
}

export interface SamplingCadenceDecision {
  readonly intervalMs: number;
  readonly reason: string;
}

function assertNonNegative(name: string, value: number): void {
  if (!(value >= 0)) {
    throw new RangeError(`${name} must be non-negative, received ${value}`);
  }
}

/**
 * Decides the next model-serving sampling interval for a session.
 * Borderline/unstable conditions take priority over "stable and high" —
 * a session that is nominally `CONFIRMED` but has just become unstable
 * (a widening interval) should sample *more* often, not less, since that
 * widening is itself the signal RFC §12 cares about.
 */
export function computeSamplingCadence(
  input: SamplingCadenceInput,
  options: SamplingCadenceOptions = {},
): SamplingCadenceDecision {
  const stableIntervalMs = options.stableIntervalMs ?? DEFAULT_STABLE_INTERVAL_MS;
  const borderlineIntervalMs = options.borderlineIntervalMs ?? DEFAULT_BORDERLINE_INTERVAL_MS;
  const baselineIntervalMs = options.baselineIntervalMs ?? DEFAULT_BASELINE_INTERVAL_MS;
  const stableMaxWidth = options.stableMaxIntervalWidth ?? DEFAULT_STABLE_MAX_INTERVAL_WIDTH;
  const unstableMinWidth = options.unstableMinIntervalWidth ?? DEFAULT_UNSTABLE_MIN_INTERVAL_WIDTH;

  assertNonNegative('stableIntervalMs', stableIntervalMs);
  assertNonNegative('borderlineIntervalMs', borderlineIntervalMs);
  assertNonNegative('baselineIntervalMs', baselineIntervalMs);

  const isUnstable =
    input.credibleIntervalWidth >= unstableMinWidth || BORDERLINE_STATES.has(input.lifecycleState);
  if (isUnstable) {
    return {
      intervalMs: borderlineIntervalMs,
      reason: 'borderline or unstable -- sampling at maximum cadence',
    };
  }

  const isStableAndHigh =
    STABLE_STATES.has(input.lifecycleState) && input.credibleIntervalWidth <= stableMaxWidth;
  if (isStableAndHigh) {
    return {
      intervalMs: stableIntervalMs,
      reason: 'stable and high confidence -- sampling at minimum cadence',
    };
  }

  return { intervalMs: baselineIntervalMs, reason: 'ordinary operation -- baseline cadence' };
}
