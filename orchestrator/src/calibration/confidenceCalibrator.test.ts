import { describe, expect, it } from 'vitest';

import type { CandidateConfidenceEvaluation } from '../candidateConfidence/types.js';
import type { FusionPosterior } from '../fusion/index.js';
import { ConfidenceCalibrator } from './confidenceCalibrator.js';

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

function evaluation(selectedProbability: number): CandidateConfidenceEvaluation {
  const selected = posterior(selectedProbability);
  return {
    selectedPosterior: selected,
    table: {
      sessionId: 'session-1',
      evaluatedAt: selected.evaluatedAt,
      rankedCandidates: [
        {
          participantId: 'candidate-a',
          probability: selectedProbability,
          confidence: selectedProbability,
          uncertainty: 0.8,
          lastUpdated: selected.evaluatedAt,
          identificationState: 'IDENTIFIED',
          topEvidenceContributors: [],
          posterior: selected,
          crossModal: null,
        },
      ],
      topParticipantId: 'candidate-a',
    },
    classification: {
      sessionId: 'session-1',
      evaluatedAt: selected.evaluatedAt,
      byParticipant: [],
    },
    contradictionMetrics: {
      sessionId: 'session-1',
      evaluatedAt: selected.evaluatedAt,
      byParticipant: [],
    },
    crossModalMetrics: {
      sessionId: 'session-1',
      evaluatedAt: selected.evaluatedAt,
      byParticipant: [],
    },
  };
}

describe('ConfidenceCalibrator', () => {
  it('passes raw probabilities through unchanged when disabled', () => {
    const calibrator = new ConfidenceCalibrator({ enabled: false });
    const calibrated = calibrator.calibratePosterior(posterior(0.72));
    expect(calibrated.rawProbability).toBe(0.72);
    expect(calibrated.probability).toBe(0.72);
  });

  it('keeps raw confidence and applies Platt scaling when enabled', () => {
    const calibrator = new ConfidenceCalibrator({
      enabled: true,
      method: 'platt',
      platt: { a: 0.5, b: 0 },
    });
    const calibrated = calibrator.calibratePosterior(posterior(0.9));
    expect(calibrated.rawProbability).toBe(0.9);
    expect(calibrated.probability).toBeLessThan(0.9);
  });

  it('applies isotonic knots when configured', () => {
    const calibrator = new ConfidenceCalibrator({
      enabled: true,
      method: 'isotonic',
      isotonicKnots: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.35 },
        { x: 1, y: 1 },
      ],
    });
    const calibrated = calibrator.calibratePosterior(posterior(0.5));
    expect(calibrated.rawProbability).toBe(0.5);
    expect(calibrated.probability).toBeCloseTo(0.35, 6);
  });

  it('calibrates candidate evaluation posteriors and ranked probabilities', () => {
    const calibrator = new ConfidenceCalibrator({
      enabled: true,
      method: 'platt',
      platt: { a: 0.5, b: 0 },
    });
    const calibrated = calibrator.calibrateEvaluation(evaluation(0.9));
    expect(calibrated.selectedPosterior.rawProbability).toBe(0.9);
    expect(calibrated.selectedPosterior.probability).toBeLessThan(0.9);
    expect(calibrated.table.rankedCandidates[0]?.confidence).toBe(
      calibrated.selectedPosterior.probability,
    );
  });
});
