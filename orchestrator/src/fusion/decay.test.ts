import { describe, expect, it } from 'vitest';

import { DEFAULT_HALF_LIFE_MS, decayWeight } from './decay.js';

describe('decayWeight', () => {
  it('returns 1 for an event with zero elapsed time', () => {
    const t = new Date('2026-07-10T12:00:00.000Z');
    expect(decayWeight(t, t)).toBe(1);
  });

  it('returns exactly 0.5 at one half-life elapsed', () => {
    const occurredAt = new Date('2026-07-10T12:00:00.000Z');
    const evaluatedAt = new Date(occurredAt.getTime() + DEFAULT_HALF_LIFE_MS);
    expect(decayWeight(occurredAt, evaluatedAt)).toBeCloseTo(0.5, 10);
  });

  it('returns exactly 0.25 at two half-lives elapsed', () => {
    const occurredAt = new Date('2026-07-10T12:00:00.000Z');
    const evaluatedAt = new Date(occurredAt.getTime() + 2 * DEFAULT_HALF_LIFE_MS);
    expect(decayWeight(occurredAt, evaluatedAt)).toBeCloseTo(0.25, 10);
  });

  it('honors a custom half-life', () => {
    const occurredAt = new Date('2026-07-10T12:00:00.000Z');
    const halfLifeMs = 60_000;
    const evaluatedAt = new Date(occurredAt.getTime() + halfLifeMs);
    expect(decayWeight(occurredAt, evaluatedAt, halfLifeMs)).toBeCloseTo(0.5, 10);
  });

  it('never exceeds 1, even for an event timestamped after the evaluation instant', () => {
    const occurredAt = new Date('2026-07-10T12:00:00.000Z');
    const evaluatedAt = new Date(occurredAt.getTime() - 60_000);
    expect(decayWeight(occurredAt, evaluatedAt)).toBe(1);
  });

  it('approaches, but never reaches, 0 for evidence many half-lives old', () => {
    const occurredAt = new Date('2026-07-10T12:00:00.000Z');
    const evaluatedAt = new Date(occurredAt.getTime() + 30 * DEFAULT_HALF_LIFE_MS);
    const weight = decayWeight(occurredAt, evaluatedAt);
    expect(weight).toBeGreaterThan(0);
    expect(weight).toBeLessThan(1e-8);
  });

  it('underflows to exactly 0, not a negative number, for extremely old evidence', () => {
    const occurredAt = new Date('2020-01-01T00:00:00.000Z');
    const evaluatedAt = new Date('2026-07-10T12:00:00.000Z');
    const weight = decayWeight(occurredAt, evaluatedAt);
    expect(weight).toBeGreaterThanOrEqual(0);
  });

  it('rejects a non-positive half-life', () => {
    const t = new Date();
    expect(() => decayWeight(t, t, 0)).toThrow(RangeError);
    expect(() => decayWeight(t, t, -1)).toThrow(RangeError);
  });
});
