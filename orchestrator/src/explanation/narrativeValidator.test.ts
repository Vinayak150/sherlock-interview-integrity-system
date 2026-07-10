import { describe, expect, it } from 'vitest';

import { validateNarrative } from './narrativeValidator.js';
import type { EvidenceReport } from './types.js';

function report(overrides: Partial<EvidenceReport> = {}): EvidenceReport {
  return {
    sessionId: 'session-1',
    generatedAt: new Date('2026-07-10T12:00:00.000Z'),
    lifecycleState: 'LIKELY_CANDIDATE',
    probability: 0.8,
    topContributingSignals: [
      {
        bundle: 'claim',
        signalName: 'email_domain_match',
        outcome: 'SUPPORTS',
        decayedLogLikelihoodRatio: 0.15,
        occurredAt: new Date(),
      },
    ],
    contradictoryEvidence: [],
    missingEvidence: [
      {
        bundle: 'claim',
        signalName: 'calendar_invite_match',
        healthStatus: 'NO_SIGNAL_DETECTED',
        occurredAt: new Date(),
      },
    ],
    alternativeHypotheses: [],
    ...overrides,
  };
}

describe('validateNarrative', () => {
  it('accepts a narrative that only mentions signals present in the report', () => {
    const result = validateNarrative(
      'The email_domain_match signal supports the claim; calendar_invite_match was not available.',
      report(),
    );
    expect(result.valid).toBe(true);
    expect(result.unsupportedSignalNames).toHaveLength(0);
  });

  it('accepts a narrative that mentions no signal names at all', () => {
    const result = validateNarrative('This session looks fine overall.', report());
    expect(result.valid).toBe(true);
  });

  it('rejects a narrative that fabricates a signal not present in this report', () => {
    const result = validateNarrative(
      'The face_embedding_self_consistency signal strongly supports this candidate.',
      report(),
    );
    expect(result.valid).toBe(false);
    expect(result.unsupportedSignalNames).toContain('face_embedding_self_consistency');
  });

  it('rejects a narrative that fabricates multiple unsupported signals', () => {
    const result = validateNarrative(
      'Both voice_embedding_self_consistency and visual_liveness were checked.',
      report(),
    );
    expect(result.valid).toBe(false);
    expect(result.unsupportedSignalNames).toEqual(
      expect.arrayContaining(['voice_embedding_self_consistency', 'visual_liveness']),
    );
  });

  it('does not flag a signal name that is legitimately present in the report', () => {
    const result = validateNarrative(
      'email_domain_match and calendar_invite_match were both reviewed.',
      report(),
    );
    expect(result.valid).toBe(true);
  });

  it('validates against contradictoryEvidence as an allowed source too', () => {
    const withContradiction = report({
      contradictoryEvidence: [
        {
          bundle: 'visual',
          signalName: 'visual_liveness',
          outcome: 'CONTRADICTS',
          decayedLogLikelihoodRatio: -0.5,
          occurredAt: new Date(),
        },
      ],
    });
    const result = validateNarrative('The visual_liveness check failed.', withContradiction);
    expect(result.valid).toBe(true);
  });
});
