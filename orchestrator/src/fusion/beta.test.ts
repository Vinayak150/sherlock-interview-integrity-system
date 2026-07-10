import { describe, expect, it } from 'vitest';

import { betaCredibleInterval, betaQuantile, logGamma, regularizedIncompleteBeta } from './beta.js';

describe('logGamma', () => {
  it('matches known Gamma function values', () => {
    expect(logGamma(1)).toBeCloseTo(0, 10); // Gamma(1) = 1
    expect(logGamma(2)).toBeCloseTo(0, 10); // Gamma(2) = 1
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 8); // Gamma(5) = 4! = 24
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 8); // Gamma(0.5) = sqrt(pi)
  });
});

describe('regularizedIncompleteBeta', () => {
  it('is the identity function for Beta(1, 1) (the uniform distribution)', () => {
    for (const x of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(regularizedIncompleteBeta(x, 1, 1)).toBeCloseTo(x, 8);
    }
  });

  it('returns exactly 0 at x=0 and 1 at x=1 regardless of parameters', () => {
    expect(regularizedIncompleteBeta(0, 3, 7)).toBe(0);
    expect(regularizedIncompleteBeta(1, 3, 7)).toBe(1);
  });

  it('is symmetric for Beta(a, a) around x=0.5', () => {
    expect(regularizedIncompleteBeta(0.5, 4, 4)).toBeCloseTo(0.5, 8);
  });

  it('matches a known closed-form value for Beta(2, 2): I_x(2,2) = 3x^2 - 2x^3', () => {
    for (const x of [0.2, 0.4, 0.6, 0.8]) {
      const expected = 3 * x ** 2 - 2 * x ** 3;
      expect(regularizedIncompleteBeta(x, 2, 2)).toBeCloseTo(expected, 6);
    }
  });

  it('is monotonically increasing in x', () => {
    const xs = [0.05, 0.2, 0.4, 0.6, 0.8, 0.95];
    const values = xs.map((x) => regularizedIncompleteBeta(x, 3, 5));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1] as number);
    }
  });

  it('rejects a non-positive shape parameter', () => {
    expect(() => regularizedIncompleteBeta(0.5, 0, 1)).toThrow(RangeError);
    expect(() => regularizedIncompleteBeta(0.5, 1, -1)).toThrow(RangeError);
  });
});

describe('betaQuantile', () => {
  it('inverts the identity CDF for Beta(1, 1)', () => {
    for (const p of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      expect(betaQuantile(p, 1, 1)).toBeCloseTo(p, 6);
    }
  });

  it('returns the median at 0.5 for a symmetric Beta(a, a)', () => {
    expect(betaQuantile(0.5, 6, 6)).toBeCloseTo(0.5, 6);
  });

  it('round-trips through regularizedIncompleteBeta', () => {
    const alpha = 4.2;
    const beta = 9.7;
    for (const p of [0.1, 0.3, 0.6, 0.9]) {
      const x = betaQuantile(p, alpha, beta);
      expect(regularizedIncompleteBeta(x, alpha, beta)).toBeCloseTo(p, 4);
    }
  });

  it('returns exactly 0 for p=0 and 1 for p=1', () => {
    expect(betaQuantile(0, 3, 3)).toBe(0);
    expect(betaQuantile(1, 3, 3)).toBe(1);
  });

  it('rejects p outside [0, 1]', () => {
    expect(() => betaQuantile(-0.1, 2, 2)).toThrow(RangeError);
    expect(() => betaQuantile(1.1, 2, 2)).toThrow(RangeError);
  });
});

describe('betaCredibleInterval', () => {
  it('returns [0.05, 0.95] for a 90% interval on the uniform Beta(1, 1)', () => {
    const interval = betaCredibleInterval(1, 1, 0.9);
    expect(interval.lower).toBeCloseTo(0.05, 6);
    expect(interval.upper).toBeCloseTo(0.95, 6);
    expect(interval.mass).toBe(0.9);
  });

  it('narrows as alpha+beta (evidence volume) grows, holding the mean fixed', () => {
    const sparse = betaCredibleInterval(5, 5, 0.9);
    const abundant = betaCredibleInterval(50, 50, 0.9);

    expect(abundant.upper - abundant.lower).toBeLessThan(sparse.upper - sparse.lower);
  });

  it('is centered away from 0.5 when alpha and beta are asymmetric', () => {
    const interval = betaCredibleInterval(20, 5, 0.9);
    expect(interval.lower).toBeGreaterThan(0.5);
  });

  it('rejects a mass outside (0, 1)', () => {
    expect(() => betaCredibleInterval(2, 2, 0)).toThrow(RangeError);
    expect(() => betaCredibleInterval(2, 2, 1)).toThrow(RangeError);
  });
});
