import type { PlattScalingParameters } from './types.js';

const PROBABILITY_EPSILON = 1e-15;

export function clampUnitInterval(value: number): number {
  if (!(value >= 0 && value <= 1)) {
    throw new RangeError(`probability must be within [0, 1], received ${value}`);
  }
  return Math.min(Math.max(value, PROBABILITY_EPSILON), 1 - PROBABILITY_EPSILON);
}

export function logit(probability: number): number {
  const clamped = clampUnitInterval(probability);
  return Math.log(clamped / (1 - clamped));
}

export function sigmoid(logOdds: number): number {
  return 1 / (1 + Math.exp(-logOdds));
}

/**
 * Platt scaling: maps a raw probability through a logistic on the logit
 * scale. With `a = 1` and `b = 0` this is the identity transform.
 */
export function applyPlattScaling(
  rawProbability: number,
  parameters: PlattScalingParameters,
): number {
  const calibratedLogOdds = parameters.a * logit(rawProbability) + parameters.b;
  return sigmoid(calibratedLogOdds);
}
