import { describe, expect, it } from 'vitest';

import { applyIsotonicRegression, fitIsotonicRegression } from './isotonicRegression.js';

describe('applyIsotonicRegression', () => {
  const knots = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.4 },
    { x: 1, y: 1 },
  ] as const;

  it('interpolates between knots', () => {
    expect(applyIsotonicRegression(0.25, knots)).toBeCloseTo(0.2, 6);
  });

  it('clamps below the first knot and above the last knot', () => {
    expect(applyIsotonicRegression(0, knots)).toBeCloseTo(0, 10);
    expect(applyIsotonicRegression(1, knots)).toBe(1);
  });

  it('rejects unsorted knots', () => {
    expect(() =>
      applyIsotonicRegression(0.5, [
        { x: 0.5, y: 0.5 },
        { x: 0.25, y: 0.3 },
      ]),
    ).toThrow(RangeError);
  });
});

describe('fitIsotonicRegression', () => {
  it('produces a monotonic mapping that lowers overconfident bins', () => {
    const knots = fitIsotonicRegression([
      { rawProbability: 0.1, actualOutcome: false },
      { rawProbability: 0.2, actualOutcome: false },
      { rawProbability: 0.8, actualOutcome: true },
      { rawProbability: 0.9, actualOutcome: true },
      { rawProbability: 0.95, actualOutcome: false },
      { rawProbability: 0.99, actualOutcome: false },
    ]);

    expect(knots[0]?.y).toBeLessThanOrEqual(knots[knots.length - 1]?.y ?? 1);
    expect(applyIsotonicRegression(0.95, knots)).toBeLessThan(0.95);
    expect(applyIsotonicRegression(0.2, knots)).toBeLessThan(0.5);
  });
});
