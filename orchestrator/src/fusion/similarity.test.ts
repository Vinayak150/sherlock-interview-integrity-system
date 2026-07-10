import { describe, expect, it } from 'vitest';

import { cosineSimilarity } from './similarity.js';

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it('is -1 for exactly opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it('is scale-invariant', () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
  });

  it('returns 0, not NaN, for a zero vector', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('rejects vectors of different lengths', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(RangeError);
  });

  it('rejects empty vectors', () => {
    expect(() => cosineSimilarity([], [])).toThrow(RangeError);
  });

  it('never returns a value outside [-1, 1] despite floating-point drift', () => {
    const a = [0.1, 0.2, 0.3, 0.4, 0.5];
    const similarity = cosineSimilarity(a, a);
    expect(similarity).toBeLessThanOrEqual(1);
    expect(similarity).toBeGreaterThanOrEqual(-1);
  });
});
