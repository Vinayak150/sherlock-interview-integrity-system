/**
 * The CUSUM change-point layer (RFC §5: "A lightweight CUSUM /
 * Bayesian-online-change-point layer runs on each bundle's embedding
 * stream to catch a regime change — a mid-call swap — treated as
 * qualitatively different from, and weighted far more heavily than,
 * ordinary noisy evidence"; Plan M9: "add the CUSUM/change-point
 * detector"). This is the real producer for the `ContradictionSignal`
 * seam `statemachine/lifecycle.ts` (M4) deliberately left abstract,
 * pending exactly this milestone.
 *
 * Standard one-sided CUSUM for detecting a *drop* in self-consistency
 * similarity (a swap looks like similarity suddenly falling, not rising):
 * `S_t = max(0, S_{t-1} + max(0, target - x_t - slack))`, flagged when
 * `S_t` exceeds a control limit. `slack` absorbs ordinary measurement
 * noise (chosen deliberately over a heavier learned change-point model,
 * per RFC §5: "the simplest tool that actually solves the stated
 * problem"). The accumulator resets to zero once a change-point fires,
 * standard CUSUM practice, so one flagged event does not saturate the
 * detector against ever firing again.
 */

/** Expected similarity when a session's embedding stream is genuinely self-consistent — a Phase-1, hand-set placeholder (same caveat as `fusion/likelihoodRatios.ts`). */
export const DEFAULT_TARGET_SIMILARITY = 0.85;
/** Allowance for ordinary measurement noise around the target. */
export const DEFAULT_SLACK = 0.05;
/** Cumulative deviation that triggers a change-point. */
export const DEFAULT_CONTROL_LIMIT = 0.3;

export interface ChangePointDetectorState {
  readonly cumulativeDeviation: number;
  readonly sampleCount: number;
}

export const INITIAL_CHANGE_POINT_STATE: ChangePointDetectorState = {
  cumulativeDeviation: 0,
  sampleCount: 0,
};

export interface ChangePointDetectorOptions {
  readonly targetSimilarity?: number;
  readonly slack?: number;
  readonly controlLimit?: number;
}

export interface ChangePointObservation {
  readonly state: ChangePointDetectorState;
  readonly changePointDetected: boolean;
}

function assertUnitInterval(name: string, value: number): void {
  if (!(value >= -1 && value <= 1)) {
    throw new RangeError(`${name} must be within [-1, 1], received ${value}`);
  }
}

/**
 * Pure update step: given the current accumulator state and a newly
 * observed similarity, returns the next state and whether this
 * observation just triggered a change-point.
 */
export function observeChangePoint(
  state: ChangePointDetectorState,
  observedSimilarity: number,
  options: ChangePointDetectorOptions = {},
): ChangePointObservation {
  assertUnitInterval('observedSimilarity', observedSimilarity);
  const target = options.targetSimilarity ?? DEFAULT_TARGET_SIMILARITY;
  const slack = options.slack ?? DEFAULT_SLACK;
  const controlLimit = options.controlLimit ?? DEFAULT_CONTROL_LIMIT;

  // Standard one-sided CUSUM (Page's test): the inner term is allowed to go negative -- that
  // is exactly what lets a comfortably-above-target observation *reduce* the accumulator
  // (recovery), not just fail to add to it. Only the outer clamp prevents drifting below zero.
  const deviation = target - observedSimilarity - slack;
  const cumulativeDeviation = Math.max(0, state.cumulativeDeviation + deviation);
  const changePointDetected = cumulativeDeviation > controlLimit;

  return {
    state: {
      cumulativeDeviation: changePointDetected ? 0 : cumulativeDeviation,
      sampleCount: state.sampleCount + 1,
    },
    changePointDetected,
  };
}

/**
 * Per-(session, bundle) stateful wrapper, matching this codebase's
 * established manager pattern (`FusionEngine`, `LifecycleStateManager`).
 * Keyed on `${sessionId}:${bundle}` since RFC §5 runs change-point
 * detection independently "on each bundle's embedding stream" — a visual
 * regime change and an audio regime change are tracked separately.
 */
export class ChangePointDetector {
  private readonly stateByKey = new Map<string, ChangePointDetectorState>();

  observe(
    sessionId: string,
    bundle: string,
    similarity: number,
    options?: ChangePointDetectorOptions,
  ): ChangePointObservation {
    const key = `${sessionId}:${bundle}`;
    const current = this.stateByKey.get(key) ?? INITIAL_CHANGE_POINT_STATE;
    const result = observeChangePoint(current, similarity, options);
    this.stateByKey.set(key, result.state);
    return result;
  }

  getState(sessionId: string, bundle: string): ChangePointDetectorState {
    return this.stateByKey.get(`${sessionId}:${bundle}`) ?? INITIAL_CHANGE_POINT_STATE;
  }
}
