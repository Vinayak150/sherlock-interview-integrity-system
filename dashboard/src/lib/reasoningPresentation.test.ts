import { describe, expect, it } from 'vitest';

import { buildTimeline, parseStreamDecision, type StreamDecision } from './decisionData.js';
import {
  buildAiEvidenceSummary,
  buildContradictionItems,
  buildCrossModalConsistencyView,
  buildExplanationView,
  buildSessionDiagnostics,
  confidenceBand,
} from './reasoningPresentation.js';
import { classifyEvidenceEvent } from './signalClassification.js';

function decision(overrides: Partial<StreamDecision> = {}): StreamDecision {
  const base: StreamDecision = {
    sessionId: 'session-1',
    decidedAt: '2026-07-10T12:00:00.000Z',
    lifecycleState: 'LIKELY_CANDIDATE',
    abstained: false,
    ambiguous: false,
    reviewerRecommendation: 'MONITOR',
    alert: null,
    elicitationTrigger: null,
    evidenceRef: {
      capturedAt: '2026-07-10T12:00:00.000Z',
      events: [],
      posterior: {
        probability: 0.72,
        logOdds: 0.9,
        evaluatedAt: '2026-07-10T12:00:00.000Z',
        rawProbability: 0.68,
        credibleInterval: { lower: 0.55, upper: 0.85, mass: 0.9 },
        bundleContributions: [
          { bundle: 'claim', logOddsContribution: 0.12, eligibleEventCount: 2 },
        ],
        eligibleEventCount: 2,
      },
    },
  };
  return { ...base, ...overrides };
}

describe('signalClassification', () => {
  it('classifies claim match outcomes from event values', () => {
    expect(
      classifyEvidenceEvent({
        id: '1',
        bundle: 'claim',
        signalName: 'display_name_match',
        healthStatus: 'OK',
        occurredAt: '2026-07-10T12:00:00.000Z',
        recordedAt: '2026-07-10T12:00:00.000Z',
        value: { matched: false },
      }),
    ).toBe('CONTRADICTS');
  });
});

describe('reasoningPresentation', () => {
  it('buildAiEvidenceSummary exposes raw and calibrated confidence when present', () => {
    const summary = buildAiEvidenceSummary(decision());
    expect(summary?.confidence).toBe(0.72);
    expect(summary?.rawConfidence).toBe(0.68);
    expect(summary?.calibratedConfidence).toBe(0.72);
    expect(summary?.band).toBe(confidenceBand(0.72));
  });

  it('buildCrossModalConsistencyView maps modalities from latest signals', () => {
    const view = buildCrossModalConsistencyView(
      decision({
        evidenceRef: {
          capturedAt: '2026-07-10T12:00:00.000Z',
          events: [
            {
              id: 'e1',
              bundle: 'visual',
              signalName: 'face_embedding_self_consistency',
              healthStatus: 'OK',
              occurredAt: '2026-07-10T12:00:00.000Z',
              recordedAt: '2026-07-10T12:00:00.000Z',
              value: { similarity: 0.9, isFirstObservation: false },
            },
            {
              id: 'e2',
              bundle: 'claim',
              signalName: 'display_name_match',
              healthStatus: 'OK',
              occurredAt: '2026-07-10T12:00:00.000Z',
              recordedAt: '2026-07-10T12:00:00.000Z',
              value: { matched: false },
            },
          ],
          posterior: decision().evidenceRef.posterior,
        },
      }),
    );

    expect(view?.modalities.find((row) => row.modality === 'Face')?.stance).toBe('ALIGNED');
    expect(view?.modalities.find((row) => row.modality === 'Metadata')?.stance).toBe(
      'CONTRADICTING',
    );
  });

  it('buildContradictionItems groups contradicting events by severity', () => {
    const items = buildContradictionItems(
      decision({
        evidenceRef: {
          capturedAt: '2026-07-10T12:00:00.000Z',
          events: [
            {
              id: 'e1',
              bundle: 'visual',
              signalName: 'visual_liveness',
              healthStatus: 'OK',
              occurredAt: '2026-07-10T12:00:00.000Z',
              recordedAt: '2026-07-10T12:00:00.000Z',
              value: { isLive: false, score: 0.1 },
            },
          ],
          posterior: decision().evidenceRef.posterior,
        },
      }),
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.severity).toBe('HIGH');
  });

  it('buildExplanationView separates supporting, conflicting, and missing evidence', () => {
    const view = buildExplanationView(
      decision({
        evidenceRef: {
          capturedAt: '2026-07-10T12:00:00.000Z',
          events: [
            {
              id: 'e1',
              bundle: 'visual',
              signalName: 'face_embedding_self_consistency',
              healthStatus: 'OK',
              occurredAt: '2026-07-10T12:00:00.000Z',
              recordedAt: '2026-07-10T12:00:00.000Z',
              value: { similarity: 0.9, isFirstObservation: false },
            },
            {
              id: 'e2',
              bundle: 'audio',
              signalName: 'voice_embedding_self_consistency',
              healthStatus: 'NO_SIGNAL_DETECTED',
              occurredAt: '2026-07-10T12:00:00.000Z',
              recordedAt: '2026-07-10T12:00:00.000Z',
              value: null,
            },
          ],
          posterior: decision().evidenceRef.posterior,
        },
      }),
    );

    expect(view?.supportingEvidence).toHaveLength(1);
    expect(view?.missingEvidence).toHaveLength(1);
    expect(view?.executiveSummary).toContain('Lifecycle state');
  });

  it('buildSessionDiagnostics returns null when no diagnostic fields exist', () => {
    expect(buildSessionDiagnostics(decision())).toBeNull();
  });

  it('parseStreamDecision preserves rawProbability and event values', () => {
    const parsed = parseStreamDecision({
      sessionId: 'session-1',
      decidedAt: '2026-07-10T12:00:00.000Z',
      lifecycleState: 'UNKNOWN',
      abstained: false,
      ambiguous: false,
      reviewerRecommendation: 'NONE',
      alert: null,
      elicitationTrigger: null,
      evidenceRef: {
        capturedAt: '2026-07-10T12:00:00.000Z',
        events: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            bundle: 'claim',
            signalName: 'display_name_match',
            healthStatus: 'OK',
            occurredAt: '2026-07-10T12:00:00.000Z',
            recordedAt: '2026-07-10T12:00:00.000Z',
            value: { matched: true },
          },
        ],
        posterior: {
          probability: 0.5,
          logOdds: 0,
          evaluatedAt: '2026-07-10T12:00:00.000Z',
          rawProbability: 0.48,
          credibleInterval: { lower: 0.4, upper: 0.6, mass: 0.9 },
          bundleContributions: [],
          eligibleEventCount: 1,
        },
      },
    });

    expect(parsed?.evidenceRef.posterior.rawProbability).toBe(0.48);
    expect(parsed?.evidenceRef.events[0]?.value).toEqual({ matched: true });
  });
});

describe('buildTimeline', () => {
  it('includes classification and confidence impact steps for new evidence', () => {
    const first = decision({
      evidenceRef: {
        capturedAt: '2026-07-10T12:00:00.000Z',
        events: [
          {
            id: 'e1',
            bundle: 'claim',
            signalName: 'display_name_match',
            healthStatus: 'OK',
            occurredAt: '2026-07-10T12:00:00.000Z',
            recordedAt: '2026-07-10T12:00:00.000Z',
            value: { matched: false },
          },
        ],
        posterior: decision().evidenceRef.posterior,
      },
    });

    const events = buildTimeline([first]);
    expect(events.some((event) => event.title === 'Classification')).toBe(true);
    expect(events.some((event) => event.title === 'Confidence impact')).toBe(true);
    expect(events.some((event) => event.title === 'Current confidence')).toBe(true);
  });
});
