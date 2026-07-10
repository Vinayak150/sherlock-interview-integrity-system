import { describe, expect, it } from 'vitest';

import { computeExpectedCalibrationError } from './calibration.js';

describe('computeExpectedCalibrationError', () => {
  it('returns 0 for an empty sample set', () => {
    expect(computeExpectedCalibrationError([])).toBe(0);
  });

  it('returns 0 for a perfectly calibrated set of samples', () => {
    // 10 samples at predicted 0.9, exactly 9 of which are true (90% actual rate matches).
    const samples = Array.from({ length: 10 }, (_, i) => ({
      predictedProbability: 0.9,
      actualOutcome: i < 9,
    }));
    expect(computeExpectedCalibrationError(samples)).toBeCloseTo(0, 6);
  });

  it('returns a large ECE for a badly miscalibrated set (always confident, always wrong)', () => {
    const samples = Array.from({ length: 10 }, () => ({
      predictedProbability: 0.95,
      actualOutcome: false,
    }));
    expect(computeExpectedCalibrationError(samples)).toBeCloseTo(0.95, 6);
  });

  it('weights bins by their share of total samples', () => {
    const manySamplesAtLowConfidence = Array.from({ length: 90 }, () => ({
      predictedProbability: 0.5,
      actualOutcome: Math.random() < 0.5, // roughly calibrated
    }));
    const fewMiscalibratedSamples = Array.from({ length: 10 }, () => ({
      predictedProbability: 0.95,
      actualOutcome: false, // badly miscalibrated, but only 10% of the data
    }));
    const ece = computeExpectedCalibrationError([
      ...manySamplesAtLowConfidence,
      ...fewMiscalibratedSamples,
    ]);
    // The small, badly-miscalibrated slice should not dominate the overall metric.
    expect(ece).toBeLessThan(0.2);
  });

  it('rejects a predictedProbability outside [0, 1]', () => {
    expect(() =>
      computeExpectedCalibrationError([{ predictedProbability: 1.5, actualOutcome: true }]),
    ).toThrow(RangeError);
  });

  it('rejects a non-positive binCount', () => {
    expect(() =>
      computeExpectedCalibrationError([{ predictedProbability: 0.5, actualOutcome: true }], 0),
    ).toThrow(RangeError);
  });

  it('handles a predictedProbability of exactly 1.0 without an out-of-bounds bin', () => {
    expect(() =>
      computeExpectedCalibrationError([{ predictedProbability: 1.0, actualOutcome: true }]),
    ).not.toThrow();
  });

  it('is always non-negative', () => {
    const samples = [
      { predictedProbability: 0.2, actualOutcome: true },
      { predictedProbability: 0.8, actualOutcome: false },
    ];
    expect(computeExpectedCalibrationError(samples)).toBeGreaterThanOrEqual(0);
  });
});
