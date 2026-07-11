import { describe, expect, it } from 'vitest';

import type { FusionPosterior } from '../fusion/index.js';
import { buildStructuredEvidenceSummary } from './evidenceSummary.js';

function posterior(probability: number, rawProbability?: number): FusionPosterior {
  return {
    sessionId: 'session-1',
    evaluatedAt: new Date('2026-07-10T12:00:00.000Z'),
    logOdds: 0,
    probability,
    ...(rawProbability === undefined ? {} : { rawProbability }),
    beta: { alpha: 1, beta: 1 },
    credibleInterval: { lower: 0.1, upper: 0.9, mass: 0.9 },
    bundleContributions: [],
    eligibleEventCount: 1,
  };
}

describe('buildStructuredEvidenceSummary rawConfidence', () => {
  it('exposes raw and effective confidence separately when calibration is applied', () => {
    const summary = buildStructuredEvidenceSummary(
      'LIKELY_CANDIDATE',
      posterior(0.62, 0.9),
      [],
      [],
      [],
    );

    expect(summary.confidence).toBe(0.62);
    expect(summary.rawConfidence).toBe(0.9);
  });
});
