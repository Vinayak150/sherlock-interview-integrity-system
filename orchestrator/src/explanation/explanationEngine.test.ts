import type { EvidenceEvent } from '@sherlock/contracts';
import { describe, expect, it } from 'vitest';

import { DEFAULT_HALF_LIFE_MS } from '../fusion/index.js';
import {
  computeSessionContradictionMetrics,
  indexEvidenceEvents,
} from '../candidateConfidence/contradictionMetrics.js';
import { computeSessionCrossModalMetrics } from '../candidateConfidence/crossModalConsistency.js';
import { buildSessionEvidenceClassification, buildParticipantClassification } from '../evidenceClassification/index.js';
import type { FusionPosterior } from '../fusion/index.js';
import { ExplanationEngine } from './explanationEngine.js';

const T0 = new Date('2026-07-10T12:00:00.000Z');
let nextId = 0;

function evidenceEvent(overrides: Partial<EvidenceEvent> = {}): EvidenceEvent {
  nextId += 1;
  return {
    id: `00000000-0000-0000-0000-${String(nextId).padStart(12, '0')}`,
    sessionId: 'session-1',
    bundle: 'claim',
    signalName: 'email_domain_match',
    healthStatus: 'OK',
    value: { matched: true, observedValue: 'a', claimedValue: 'a' },
    occurredAt: T0,
    recordedAt: T0,
    metadata: null,
    ...overrides,
  };
}

function posterior(overrides: Partial<FusionPosterior> = {}): FusionPosterior {
  return {
    sessionId: 'session-1',
    evaluatedAt: T0,
    logOdds: 0.2,
    probability: 0.55,
    beta: { alpha: 2, beta: 1.6 },
    credibleInterval: { lower: 0.3, upper: 0.8, mass: 0.9 },
    bundleContributions: [],
    eligibleEventCount: 0,
    ...overrides,
  };
}

describe('ExplanationEngine.buildReport', () => {
  const engine = new ExplanationEngine();

  it('reflects sessionId, lifecycleState, probability, and generatedAt', () => {
    const report = engine.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'LIKELY_CANDIDATE',
      posterior: posterior({ probability: 0.72 }),
      events: [],
      generatedAt: T0,
    });

    expect(report.sessionId).toBe('session-1');
    expect(report.lifecycleState).toBe('LIKELY_CANDIDATE');
    expect(report.probability).toBe(0.72);
    expect(report.generatedAt).toBe(T0);
  });

  it('produces an empty report for a session with no evidence, never crashing', () => {
    const report = engine.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'UNKNOWN',
      posterior: posterior(),
      events: [],
      generatedAt: T0,
    });

    expect(report.topContributingSignals).toHaveLength(0);
    expect(report.contradictoryEvidence).toHaveLength(0);
    expect(report.missingEvidence).toHaveLength(0);
    expect(report.alternativeHypotheses).toHaveLength(0);
  });

  it('includes a matched claim signal as a contributing signal with SUPPORTS outcome', () => {
    const report = engine.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'POSSIBLE_CANDIDATE',
      posterior: posterior(),
      events: [evidenceEvent({ value: { matched: true, observedValue: 'a', claimedValue: 'a' } })],
      generatedAt: T0,
    });

    expect(report.topContributingSignals).toHaveLength(1);
    expect(report.topContributingSignals[0]).toMatchObject({
      signalName: 'email_domain_match',
      outcome: 'SUPPORTS',
    });
    expect(report.topContributingSignals[0]?.decayedLogLikelihoodRatio).toBeGreaterThan(0);
  });

  it('places a mismatched claim signal in both topContributingSignals and contradictoryEvidence', () => {
    const report = engine.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'LOST_CONFIDENCE',
      posterior: posterior({ probability: 0.3 }),
      events: [evidenceEvent({ value: { matched: false, observedValue: 'a', claimedValue: 'b' } })],
      generatedAt: T0,
    });

    expect(report.topContributingSignals).toHaveLength(1);
    expect(report.contradictoryEvidence).toHaveLength(1);
    expect(report.contradictoryEvidence[0]?.outcome).toBe('CONTRADICTS');
    expect(report.contradictoryEvidence[0]?.decayedLogLikelihoodRatio).toBeLessThan(0);
  });

  it('excludes a NEUTRAL-outcome signal (e.g. an unavailable presence-only claim signal) from contributing signals', () => {
    const report = engine.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'POSSIBLE_CANDIDATE',
      posterior: posterior(),
      events: [
        evidenceEvent({
          signalName: 'reference_photo_available',
          value: { available: false, reference: null },
        }),
      ],
      generatedAt: T0,
    });

    expect(report.topContributingSignals).toHaveLength(0);
    expect(report.missingEvidence).toHaveLength(0);
  });

  it('categorizes NO_SIGNAL_DETECTED events as missing evidence, never as contradictory', () => {
    const report = engine.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'UNKNOWN',
      posterior: posterior(),
      events: [
        evidenceEvent({
          signalName: 'calendar_invite_match',
          healthStatus: 'NO_SIGNAL_DETECTED',
          value: { matched: false, observedValue: null, claimedValue: null },
        }),
      ],
      generatedAt: T0,
    });

    expect(report.missingEvidence).toHaveLength(1);
    expect(report.missingEvidence[0]).toMatchObject({
      signalName: 'calendar_invite_match',
      healthStatus: 'NO_SIGNAL_DETECTED',
    });
    expect(report.topContributingSignals).toHaveLength(0);
    expect(report.contradictoryEvidence).toHaveLength(0);
  });

  it('categorizes SERVICE_UNAVAILABLE events as missing evidence, never as contradictory', () => {
    const report = engine.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'UNKNOWN',
      posterior: posterior(),
      events: [
        evidenceEvent({
          signalName: 'display_name_match',
          healthStatus: 'SERVICE_UNAVAILABLE',
          value: { reason: 'ATS unavailable' },
        }),
      ],
      generatedAt: T0,
    });

    expect(report.missingEvidence).toHaveLength(1);
    expect(report.missingEvidence[0]?.healthStatus).toBe('SERVICE_UNAVAILABLE');
    expect(report.topContributingSignals).toHaveLength(0);
  });

  it('ranks contributing signals descending by absolute decayed log-likelihood-ratio', () => {
    const report = engine.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'LIKELY_CANDIDATE',
      posterior: posterior(),
      events: [
        evidenceEvent({
          signalName: 'display_name_match',
          value: { matched: true, observedValue: 'a', claimedValue: 'a' },
        }),
        evidenceEvent({
          bundle: 'metadata',
          signalName: 'virtual_capture_device_detected',
          value: { detected: true },
        }),
        evidenceEvent({
          signalName: 'email_domain_match',
          value: { matched: true, observedValue: 'a', claimedValue: 'a' },
        }),
      ],
      generatedAt: T0,
    });

    const magnitudes = report.topContributingSignals.map((s) =>
      Math.abs(s.decayedLogLikelihoodRatio),
    );
    for (let i = 1; i < magnitudes.length; i++) {
      expect(magnitudes[i]).toBeLessThanOrEqual(magnitudes[i - 1] as number);
    }
    // virtual_capture_device_detected (0.3 magnitude) should outrank display_name_match (0.05).
    expect(report.topContributingSignals[0]?.signalName).toBe('virtual_capture_device_detected');
  });

  it('applies decay so an older event contributes less than an identical fresh one', () => {
    const evaluatedAt = new Date(T0.getTime() + DEFAULT_HALF_LIFE_MS);
    const report = engine.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'POSSIBLE_CANDIDATE',
      posterior: posterior(),
      events: [
        evidenceEvent({
          occurredAt: T0,
          value: { matched: true, observedValue: 'a', claimedValue: 'a' },
        }),
      ],
      generatedAt: evaluatedAt,
    });

    const freshReport = engine.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'POSSIBLE_CANDIDATE',
      posterior: posterior(),
      events: [
        evidenceEvent({
          occurredAt: evaluatedAt,
          value: { matched: true, observedValue: 'a', claimedValue: 'a' },
        }),
      ],
      generatedAt: evaluatedAt,
    });

    expect(report.topContributingSignals[0]?.decayedLogLikelihoodRatio).toBeCloseTo(
      (freshReport.topContributingSignals[0]?.decayedLogLikelihoodRatio ?? 0) / 2,
      6,
    );
  });

  it('honors a custom halfLifeMs consistently with the Fusion Engine that produced the posterior', () => {
    const shortHalfLife = new ExplanationEngine({ halfLifeMs: 1_000 });
    const evaluatedAt = new Date(T0.getTime() + 1_000);
    const report = shortHalfLife.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'POSSIBLE_CANDIDATE',
      posterior: posterior(),
      events: [
        evidenceEvent({
          occurredAt: T0,
          value: { matched: true, observedValue: 'a', claimedValue: 'a' },
        }),
      ],
      generatedAt: evaluatedAt,
    });

    // Exactly one custom half-life elapsed -> magnitude should be roughly half of the undecayed value.
    expect(Math.abs(report.topContributingSignals[0]?.decayedLogLikelihoodRatio ?? 0)).toBeCloseTo(
      0.075,
      3,
    );
  });

  it('truncates topContributingSignals to maxTopSignals but keeps the full contradictoryEvidence/missingEvidence lists unaffected by that cap', () => {
    const boundedEngine = new ExplanationEngine({ maxTopSignals: 1 });
    const report = boundedEngine.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'LIKELY_CANDIDATE',
      posterior: posterior(),
      events: [
        evidenceEvent({
          signalName: 'display_name_match',
          value: { matched: false, observedValue: 'a', claimedValue: 'b' },
        }),
        evidenceEvent({
          bundle: 'metadata',
          signalName: 'virtual_capture_device_detected',
          value: { detected: true },
        }),
      ],
      generatedAt: T0,
    });

    expect(report.topContributingSignals).toHaveLength(1);
    expect(report.contradictoryEvidence).toHaveLength(2);
  });

  it('filters out events belonging to a different session', () => {
    const report = engine.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'POSSIBLE_CANDIDATE',
      posterior: posterior(),
      events: [
        evidenceEvent({
          sessionId: 'session-1',
          value: { matched: true, observedValue: 'a', claimedValue: 'a' },
        }),
        evidenceEvent({
          sessionId: 'session-2',
          value: { matched: true, observedValue: 'a', claimedValue: 'a' },
        }),
      ],
      generatedAt: T0,
    });

    expect(report.topContributingSignals).toHaveLength(1);
  });

  it('always returns an empty alternativeHypotheses list (no visual/audio/role-assignment data exists yet)', () => {
    const report = engine.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'CONFIRMED',
      posterior: posterior({ probability: 0.97 }),
      events: [evidenceEvent()],
      generatedAt: T0,
    });

    expect(report.alternativeHypotheses).toEqual([]);
  });

  it('rejects a non-positive halfLifeMs', () => {
    expect(() => new ExplanationEngine({ halfLifeMs: 0 })).toThrow(RangeError);
  });

  it('rejects a non-positive maxTopSignals', () => {
    expect(() => new ExplanationEngine({ maxTopSignals: -1 })).toThrow(RangeError);
  });

  it('builds a structured summary with strongest support, conflicts, gaps, confidence, uncertainty, and recommendation', () => {
    const report = engine.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'DISQUALIFIED',
      posterior: posterior({ probability: 0.72 }),
      events: [
        evidenceEvent({
          signalName: 'email_domain_match',
          value: { matched: true, observedValue: 'a', claimedValue: 'a' },
        }),
        evidenceEvent({
          signalName: 'display_name_match',
          value: { matched: false, observedValue: 'a', claimedValue: 'b' },
        }),
        evidenceEvent({
          signalName: 'calendar_invite_match',
          healthStatus: 'NO_SIGNAL_DETECTED',
          value: { matched: false, observedValue: null, claimedValue: null },
        }),
      ],
      generatedAt: T0,
    });

    expect(report.summary.confidence).toBe(0.72);
    expect(report.summary.uncertainty).toBeCloseTo(0.5, 5);
    expect(report.summary.recommendation).toBe('MANDATORY_REVIEW');
    expect(report.summary.strongestSupportingEvidence).toHaveLength(1);
    expect(report.summary.strongestSupportingEvidence[0]?.outcome).toBe('SUPPORTS');
    expect(report.summary.conflictingEvidence).toHaveLength(1);
    expect(report.summary.missingEvidence).toHaveLength(1);
    expect(report.summary.strongestSupportingEvidence[0]?.signalName).toBe('email_domain_match');
    expect(report.summary.contradictionReasoning).toBeNull();
    expect(report.summary.crossModalReasoning).toBeNull();
  });

  it('recommends deferring to ordinary judgment for abstention-grade UNKNOWN sessions', () => {
    const report = engine.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'UNKNOWN',
      posterior: posterior({ probability: 0.4 }),
      events: [],
      generatedAt: T0,
    });

    expect(report.summary.recommendation).toBe('DEFER_TO_ORDINARY_JUDGMENT');
  });

  it('enriches the summary with precomputed cross-modal metrics', () => {
    const face = evidenceEvent({
      bundle: 'visual',
      signalName: 'face_embedding_self_consistency',
      value: { similarity: 0.92, isFirstObservation: false },
    });
    const voice = evidenceEvent({
      bundle: 'audio',
      signalName: 'voice_embedding_self_consistency',
      value: { similarity: 0.88, isFirstObservation: false },
    });

    const classified = buildSessionEvidenceClassification('session-1', T0, [
      buildParticipantClassification('candidate-1', [face, voice]),
    ]);
    const eventsById = indexEvidenceEvents([face, voice]);
    const contradictionMetrics = computeSessionContradictionMetrics(classified, eventsById);
    const crossModalMetrics = computeSessionCrossModalMetrics(
      classified,
      eventsById,
      contradictionMetrics,
    );

    const report = engine.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'POSSIBLE_CANDIDATE',
      posterior: posterior(),
      events: [face, voice],
      generatedAt: T0,
      crossModalMetrics,
      topParticipantId: 'candidate-1',
    });

    const reasoning = report.summary.crossModalReasoning;
    const participant = crossModalMetrics.byParticipant[0]!;

    expect(reasoning).not.toBeNull();
    expect(reasoning?.crossModalConsistency).toBe(participant.crossModalConsistency);
    expect(reasoning?.crossModalConfidence).toBe(participant.crossModalConfidence);
    expect(reasoning?.crossModalDisagreement).toBe(participant.crossModalDisagreement);
    expect(reasoning?.modalities).toBe(participant.modalities);
  });
});
