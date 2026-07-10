import { describe, expect, it } from 'vitest';

import { DEFAULT_LOG_LR_CLAMP, clampLogLikelihoodRatio } from './logLikelihoodRatioClamp.js';

describe('clampLogLikelihoodRatio', () => {
  it('leaves a value within the clamp range unchanged', () => {
    expect(clampLogLikelihoodRatio(0.3)).toBe(0.3);
    expect(clampLogLikelihoodRatio(-0.3)).toBe(-0.3);
  });

  it('clamps a value above the positive limit', () => {
    expect(clampLogLikelihoodRatio(100)).toBe(DEFAULT_LOG_LR_CLAMP);
  });

  it('clamps a value below the negative limit', () => {
    expect(clampLogLikelihoodRatio(-100)).toBe(-DEFAULT_LOG_LR_CLAMP);
  });

  it('leaves 0 unchanged', () => {
    expect(clampLogLikelihoodRatio(0)).toBe(0);
  });

  it('honors a custom clamp', () => {
    expect(clampLogLikelihoodRatio(10, 1)).toBe(1);
    expect(clampLogLikelihoodRatio(-10, 1)).toBe(-1);
  });

  it('rejects a non-positive clamp', () => {
    expect(() => clampLogLikelihoodRatio(0.1, 0)).toThrow(RangeError);
    expect(() => clampLogLikelihoodRatio(0.1, -1)).toThrow(RangeError);
  });

  it('is a no-op boundary case exactly at the clamp value', () => {
    expect(clampLogLikelihoodRatio(DEFAULT_LOG_LR_CLAMP)).toBe(DEFAULT_LOG_LR_CLAMP);
    expect(clampLogLikelihoodRatio(-DEFAULT_LOG_LR_CLAMP)).toBe(-DEFAULT_LOG_LR_CLAMP);
  });
});
