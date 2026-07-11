import { describe, expect, it } from 'vitest';

import { applyPlattScaling, logit, sigmoid } from './plattScaling.js';

describe('applyPlattScaling', () => {
  it('returns the identity mapping when a=1 and b=0', () => {
    expect(applyPlattScaling(0.2, { a: 1, b: 0 })).toBeCloseTo(0.2, 6);
    expect(applyPlattScaling(0.8, { a: 1, b: 0 })).toBeCloseTo(0.8, 6);
  });

  it('compresses overconfident raw probabilities when a < 1', () => {
    const calibrated = applyPlattScaling(0.95, { a: 0.5, b: 0 });
    expect(calibrated).toBeLessThan(0.95);
    expect(calibrated).toBeGreaterThan(0.5);
  });

  it('expands underconfident raw probabilities when a > 1 and b is positive', () => {
    const calibrated = applyPlattScaling(0.6, { a: 2, b: 0.5 });
    expect(calibrated).toBeGreaterThan(0.6);
  });

  it('rejects probabilities outside the unit interval', () => {
    expect(() => applyPlattScaling(-0.1, { a: 1, b: 0 })).toThrow(RangeError);
    expect(() => applyPlattScaling(1.1, { a: 1, b: 0 })).toThrow(RangeError);
  });
});

describe('logit/sigmoid helpers', () => {
  it('round-trips 0.5 through logit and sigmoid', () => {
    expect(sigmoid(logit(0.5))).toBeCloseTo(0.5, 10);
  });
});
