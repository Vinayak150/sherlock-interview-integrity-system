import { describe, expect, it } from 'vitest';

import type { ParticipantCrossModalMetrics } from '../candidateConfidence/crossModalConsistency.js';
import { buildCrossModalReasoningSummary } from './crossModalReasoning.js';

const T0 = new Date('2026-01-01T10:00:00.000Z');

function participantMetrics(
  overrides: Partial<ParticipantCrossModalMetrics> = {},
): ParticipantCrossModalMetrics {
  return {
    participantId: 'candidate-1',
    modalities: [
      {
        modality: 'face',
        stance: 'ALIGNED',
        confidence: 0.9,
        bundle: 'visual',
        signalName: 'face_embedding_self_consistency',
        occurredAt: T0,
      },
    ],
    crossModalConsistency: 0.9,
    crossModalConfidence: 0.85,
    crossModalDisagreement: 0.1,
    ...overrides,
  };
}

describe('buildCrossModalReasoningSummary', () => {
  it('returns null when cross-modal metrics are not supplied', () => {
    expect(buildCrossModalReasoningSummary({})).toBeNull();
  });

  it('reuses precomputed participant metrics for the top participant', () => {
    const participant = participantMetrics();
    const summary = buildCrossModalReasoningSummary({
      crossModalMetrics: {
        sessionId: 'session-1',
        evaluatedAt: T0,
        byParticipant: [participant],
      },
      topParticipantId: 'candidate-1',
    });

    expect(summary?.participantId).toBe('candidate-1');
    expect(summary?.crossModalConsistency).toBe(participant.crossModalConsistency);
    expect(summary?.crossModalConfidence).toBe(participant.crossModalConfidence);
    expect(summary?.crossModalDisagreement).toBe(participant.crossModalDisagreement);
    expect(summary?.modalities).toBe(participant.modalities);
  });
});
