/**
 * Post-fusion confidence calibration (RFC §14/§16). Converts raw fusion
 * probabilities into better-calibrated estimates without changing the
 * Fusion Engine's log-odds math.
 */

export type CalibrationMethod = 'platt' | 'isotonic';

export interface PlattScalingParameters {
  /** Slope applied to the logit of the raw probability. */
  readonly a: number;
  /** Intercept added after scaling the logit. */
  readonly b: number;
}

export interface IsotonicKnot {
  readonly x: number;
  readonly y: number;
}

export interface CalibrationTrainingSample {
  readonly rawProbability: number;
  readonly actualOutcome: boolean;
}

export interface ConfidenceCalibratorOptions {
  readonly enabled?: boolean;
  readonly method?: CalibrationMethod;
  readonly platt?: PlattScalingParameters;
  readonly isotonicKnots?: readonly IsotonicKnot[];
}

/** Default identity mapping — calibrated output equals raw input. */
export const DEFAULT_PLATT_PARAMETERS: PlattScalingParameters = { a: 1, b: 0 };

export const DEFAULT_ISOTONIC_KNOTS: readonly IsotonicKnot[] = [
  { x: 0, y: 0 },
  { x: 0.25, y: 0.25 },
  { x: 0.5, y: 0.5 },
  { x: 0.75, y: 0.75 },
  { x: 1, y: 1 },
];
