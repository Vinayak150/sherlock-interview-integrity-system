import { describe, expect, it } from 'vitest';

import { confidenceBucket } from './confidenceBuckets.js';
import { buildSessionMetrics } from './sessionMetrics.js';

describe('confidenceBucket', () => {
  it('maps probabilities into five histogram buckets', () => {
    expect(confidenceBucket(0.1)).toBe('0.0-0.2');
    expect(confidenceBucket(0.5)).toBe('0.4-0.6');
    expect(confidenceBucket(0.95)).toBe('0.8-1.0');
  });
});

describe('buildSessionMetrics', () => {
  const evaluatedAt = new Date('2026-07-10T12:00:00.000Z');

  it('emits confidence, contradiction, cross-modal, and spoof metrics', () => {
    const metrics = buildSessionMetrics({
      sessionId: 'session-1',
      evaluatedAt,
      posterior: {
        sessionId: 'session-1',
        evaluatedAt,
        logOdds: 0.5,
        probability: 0.72,
        rawProbability: 0.9,
        beta: { alpha: 1, beta: 1 },
        credibleInterval: { lower: 0.2, upper: 0.8, mass: 0.9 },
        bundleContributions: [],
        eligibleEventCount: 2,
      },
      contradictionMetrics: {
        sessionId: 'session-1',
        evaluatedAt,
        byParticipant: [
          {
            participantId: 'candidate-a',
            agreementScore: 0.4,
            contradictionScore: 0.6,
            consistencyScore: 0.5,
            contradictions: [
              {
                participantId: 'candidate-a',
                conflictingParticipantId: null,
                evidenceSource: {
                  bundle: 'visual',
                  signalName: 'visual_liveness',
                  eventId: 'evt-1',
                },
                severity: 'HIGH',
                confidence: 0.8,
                occurredAt: evaluatedAt,
                timestamp: evaluatedAt,
                decayWeight: 0.9,
              },
            ],
          },
        ],
      },
      crossModalMetrics: {
        sessionId: 'session-1',
        evaluatedAt,
        byParticipant: [
          {
            participantId: 'candidate-a',
            modalities: [
              {
                modality: 'face',
                stance: 'ALIGNED',
                confidence: 0.88,
                bundle: 'visual',
                signalName: 'face_embedding_self_consistency',
                occurredAt: evaluatedAt,
              },
              {
                modality: 'speaker',
                stance: 'ALIGNED',
                confidence: 0.77,
                bundle: 'audio',
                signalName: 'voice_embedding_self_consistency',
                occurredAt: evaluatedAt,
              },
            ],
            crossModalConsistency: 0.91,
            crossModalConfidence: 0.82,
            crossModalDisagreement: 0.09,
          },
        ],
      },
      tickEvents: [
        {
          sessionId: 'session-1',
          bundle: 'visual',
          signalName: 'visual_liveness',
          healthStatus: 'OK',
          value: { score: 0.1, isLive: false },
          occurredAt: evaluatedAt,
          metadata: null,
        },
      ],
      topParticipantId: 'candidate-a',
    });

    const names = metrics.map((metric) => metric.metricName);
    expect(names).toContain('sherlock.ai.confidence.distribution');
    expect(names).toContain('sherlock.ai.contradiction.frequency');
    expect(names).toContain('sherlock.ai.cross_modal.agreement');
    expect(names).toContain('sherlock.ai.spoof.detection_rate');
    expect(names).toContain('sherlock.ai.face.confidence.distribution');
    expect(names).toContain('sherlock.ai.speaker.confidence.distribution');

    const spoof = metrics.find((metric) => metric.metricName === 'sherlock.ai.spoof.detection_rate');
    expect(spoof?.value).toBe(1);
  });
});
