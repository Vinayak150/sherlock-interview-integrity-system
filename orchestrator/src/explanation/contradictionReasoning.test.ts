import type { EvidenceEvent } from '@sherlock/contracts';
import { describe, expect, it } from 'vitest';

import {
  computeSessionContradictionMetrics,
  indexEvidenceEvents,
} from '../candidateConfidence/contradictionMetrics.js';
import type { SessionEvidenceClassification } from '../evidenceClassification/index.js';
import { DEFAULT_HALF_LIFE_MS } from '../fusion/index.js';
import type { FusionPosterior } from '../fusion/index.js';
import { buildContradictionReasoningSummary } from './contradictionReasoning.js';
import { ExplanationEngine } from './explanationEngine.js';
import type { ContributingSignal, MissingEvidenceItem } from './types.js';

const T0 = new Date('2026-01-01T10:00:00.000Z');

function event(overrides: Partial<EvidenceEvent> = {}): EvidenceEvent {
  return {
    id: 'event-1',
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

function classification(
  rows: Array<{
    participantId: string;
    items: SessionEvidenceClassification['byParticipant'][number]['items'];
  }>,
  evaluatedAt: Date = T0,
): SessionEvidenceClassification {
  return {
    sessionId: 'session-1',
    evaluatedAt,
    byParticipant: rows,
  };
}

function supportingSignal(
  overrides: Partial<ContributingSignal> = {},
): ContributingSignal {
  return {
    bundle: 'claim',
    signalName: 'email_domain_match',
    outcome: 'SUPPORTS',
    decayedLogLikelihoodRatio: 0.2,
    occurredAt: T0,
    ...overrides,
  };
}

function contradictingSignal(
  overrides: Partial<ContributingSignal> = {},
): ContributingSignal {
  return {
    bundle: 'claim',
    signalName: 'display_name_match',
    outcome: 'CONTRADICTS',
    decayedLogLikelihoodRatio: -0.15,
    occurredAt: T0,
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

describe('buildContradictionReasoningSummary', () => {
  it('returns null when contradiction metrics are not supplied', () => {
    expect(
      buildContradictionReasoningSummary({
        contributingSignals: [],
        missingEvidence: [],
        uncertainty: 0.2,
      }),
    ).toBeNull();
  });

  it('strong agreement: reuses high agreement scores and ranks supporting evidence', () => {
    const supportA = event({ id: 'support-a', signalName: 'email_domain_match' });
    const supportB = event({
      id: 'support-b',
      signalName: 'display_name_match',
      value: { matched: true, observedValue: 'x', claimedValue: 'x' },
    });

    const classified = classification([
      {
        participantId: 'candidate-1',
        items: [
          {
            eventId: supportA.id,
            sessionId: 'session-1',
            participantId: 'candidate-1',
            bundle: 'claim',
            signalName: 'email_domain_match',
            healthStatus: 'OK',
            classification: 'SUPPORTS',
            occurredAt: T0,
          },
          {
            eventId: supportB.id,
            sessionId: 'session-1',
            participantId: 'candidate-1',
            bundle: 'claim',
            signalName: 'display_name_match',
            healthStatus: 'OK',
            classification: 'SUPPORTS',
            occurredAt: T0,
          },
        ],
      },
    ]);

    const metrics = computeSessionContradictionMetrics(
      classified,
      indexEvidenceEvents([supportA, supportB]),
    );
    const participant = metrics.byParticipant[0]!;

    const reasoning = buildContradictionReasoningSummary({
      contradictionMetrics: metrics,
      classification: classified,
      contributingSignals: [
        supportingSignal({ signalName: 'display_name_match', decayedLogLikelihoodRatio: 0.1 }),
        supportingSignal({ decayedLogLikelihoodRatio: 0.25 }),
      ],
      missingEvidence: [],
      uncertainty: 0.2,
      topParticipantId: 'candidate-1',
    });

    expect(reasoning?.agreementScore).toBe(participant.agreementScore);
    expect(reasoning?.contradictionScore).toBe(participant.contradictionScore);
    expect(reasoning?.consistencyScore).toBe(participant.consistencyScore);
    expect(reasoning?.evidenceConsistency).toBe(participant.consistencyScore);
    expect(reasoning?.agreementScore).toBe(1);
    expect(reasoning?.strongestAgreements).toHaveLength(2);
    expect(reasoning?.strongestAgreements[0]?.signalName).toBe('email_domain_match');
    expect(reasoning?.reasonsConfidenceIncreased).toHaveLength(2);
    expect(reasoning?.reasonsConfidenceIncreased.every((r) => r.kind === 'SUPPORTING_EVIDENCE')).toBe(
      true,
    );
    expect(reasoning?.strongestContradictions).toHaveLength(0);
  });

  it('strong contradiction: reuses contradiction records and emits decrease reasons', () => {
    const contradict = event({
      id: 'contradict-1',
      value: { matched: false, observedValue: 'a', claimedValue: 'b' },
    });

    const classified = classification([
      {
        participantId: 'candidate-1',
        items: [
          {
            eventId: contradict.id,
            sessionId: 'session-1',
            participantId: 'candidate-1',
            bundle: 'claim',
            signalName: 'email_domain_match',
            healthStatus: 'OK',
            classification: 'CONTRADICTS',
            occurredAt: T0,
          },
        ],
      },
    ]);

    const metrics = computeSessionContradictionMetrics(
      classified,
      indexEvidenceEvents([contradict]),
    );
    const participant = metrics.byParticipant[0]!;

    const reasoning = buildContradictionReasoningSummary({
      contradictionMetrics: metrics,
      classification: classified,
      contributingSignals: [contradictingSignal()],
      missingEvidence: [],
      uncertainty: 0.2,
      topParticipantId: 'candidate-1',
    });

    expect(reasoning?.contradictionScore).toBe(participant.contradictionScore);
    expect(reasoning?.contradictionScore).toBe(1);
    expect(reasoning?.strongestContradictions).toHaveLength(1);
    expect(reasoning?.strongestContradictions[0]).toBe(participant.contradictions[0]);
    expect(reasoning?.reasonsConfidenceDecreased).toEqual([
      {
        kind: 'CONTRADICTING_EVIDENCE',
        bundle: 'claim',
        signalName: 'email_domain_match',
        participantId: 'candidate-1',
      },
    ]);
    expect(reasoning?.strongestAgreements).toHaveLength(0);
  });

  it('recovered contradiction: aged evidence yields DECAYED_CONTRADICTION reasons', () => {
    const contradict = event({
      id: 'decay-1',
      value: { matched: false, observedValue: 'a', claimedValue: 'b' },
    });
    const evaluatedAt = new Date(T0.getTime() + DEFAULT_HALF_LIFE_MS);

    const classified = classification(
      [
        {
          participantId: 'candidate-1',
          items: [
            {
              eventId: contradict.id,
              sessionId: 'session-1',
              participantId: 'candidate-1',
              bundle: 'claim',
              signalName: 'email_domain_match',
              healthStatus: 'OK',
              classification: 'CONTRADICTS',
              occurredAt: T0,
            },
          ],
        },
      ],
      evaluatedAt,
    );

    const metrics = computeSessionContradictionMetrics(
      classified,
      indexEvidenceEvents([contradict]),
    );
    const record = metrics.byParticipant[0]!.contradictions[0]!;

    expect(record.decayWeight).toBeCloseTo(0.5, 5);

    const reasoning = buildContradictionReasoningSummary({
      contradictionMetrics: metrics,
      classification: classified,
      contributingSignals: [contradictingSignal({ decayedLogLikelihoodRatio: -0.05 })],
      missingEvidence: [],
      uncertainty: 0.2,
      topParticipantId: 'candidate-1',
    });

    expect(reasoning?.reasonsConfidenceDecreased[0]?.kind).toBe('DECAYED_CONTRADICTION');
    expect(reasoning?.strongestContradictions[0]?.decayWeight).toBeCloseTo(0.5, 5);
  });

  it('mixed evidence: surfaces balanced agreement and contradiction scores', () => {
    const support = event({ id: 'support-1' });
    const contradict = event({
      id: 'contradict-1',
      signalName: 'display_name_match',
      value: { matched: false, observedValue: 'a', claimedValue: 'b' },
    });

    const classified = classification([
      {
        participantId: 'candidate-1',
        items: [
          {
            eventId: support.id,
            sessionId: 'session-1',
            participantId: 'candidate-1',
            bundle: 'claim',
            signalName: 'email_domain_match',
            healthStatus: 'OK',
            classification: 'SUPPORTS',
            occurredAt: T0,
          },
          {
            eventId: contradict.id,
            sessionId: 'session-1',
            participantId: 'candidate-1',
            bundle: 'claim',
            signalName: 'display_name_match',
            healthStatus: 'OK',
            classification: 'CONTRADICTS',
            occurredAt: T0,
          },
        ],
      },
    ]);

    const metrics = computeSessionContradictionMetrics(
      classified,
      indexEvidenceEvents([support, contradict]),
    );

    const reasoning = buildContradictionReasoningSummary({
      contradictionMetrics: metrics,
      classification: classified,
      contributingSignals: [supportingSignal(), contradictingSignal()],
      missingEvidence: [],
      uncertainty: 0.2,
      topParticipantId: 'candidate-1',
    });

    expect(reasoning?.agreementScore).toBeCloseTo(0.5, 5);
    expect(reasoning?.contradictionScore).toBeCloseTo(0.5, 5);
    expect(reasoning?.consistencyScore).toBeCloseTo(0.5, 5);
    expect(reasoning?.strongestAgreements).toHaveLength(1);
    expect(reasoning?.strongestContradictions).toHaveLength(1);
    expect(reasoning?.reasonsConfidenceIncreased).toHaveLength(1);
    expect(reasoning?.reasonsConfidenceDecreased).toHaveLength(1);
  });

  it('missing evidence: lists gaps and neutral items as uncertainty increase reasons', () => {
    const classified = classification([
      {
        participantId: 'candidate-1',
        items: [
          {
            eventId: 'neutral-1',
            sessionId: 'session-1',
            participantId: 'candidate-1',
            bundle: 'claim',
            signalName: 'calendar_invite_match',
            healthStatus: 'NO_SIGNAL_DETECTED',
            classification: 'NEUTRAL',
            occurredAt: T0,
          },
        ],
      },
    ]);

    const metrics = computeSessionContradictionMetrics(classified, new Map());
    const missingEvidence: MissingEvidenceItem[] = [
      {
        bundle: 'claim',
        signalName: 'calendar_invite_match',
        healthStatus: 'NO_SIGNAL_DETECTED',
        occurredAt: T0,
      },
    ];

    const reasoning = buildContradictionReasoningSummary({
      contradictionMetrics: metrics,
      classification: classified,
      contributingSignals: [],
      missingEvidence,
      uncertainty: 0.55,
      topParticipantId: 'candidate-1',
    });

    expect(reasoning?.ignoredEvidence).toHaveLength(1);
    expect(reasoning?.ignoredEvidence[0]?.signalName).toBe('calendar_invite_match');
    expect(reasoning?.reasonsUncertaintyIncreased).toEqual(
      expect.arrayContaining([
        {
          kind: 'MISSING_EVIDENCE',
          bundle: 'claim',
          signalName: 'calendar_invite_match',
          participantId: 'candidate-1',
        },
        {
          kind: 'IGNORED_NEUTRAL_EVIDENCE',
          bundle: 'claim',
          signalName: 'calendar_invite_match',
          participantId: 'candidate-1',
        },
        {
          kind: 'WIDE_CREDIBLE_INTERVAL',
          bundle: 'claim',
          signalName: 'credible_interval_width',
          participantId: 'candidate-1',
        },
      ]),
    );
  });
});

describe('ExplanationEngine contradiction reasoning integration', () => {
  const engine = new ExplanationEngine();

  it('leaves contradictionReasoning null when metrics are not passed', () => {
    const report = engine.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'UNKNOWN',
      posterior: posterior(),
      events: [],
      generatedAt: T0,
    });

    expect(report.summary.contradictionReasoning).toBeNull();
  });

  it('enriches the summary with precomputed metrics without recomputing scores', () => {
    const support = event({ id: 'support-1' });
    const contradict = event({
      id: 'contradict-1',
      signalName: 'display_name_match',
      value: { matched: false, observedValue: 'a', claimedValue: 'b' },
    });

    const classified = classification([
      {
        participantId: 'candidate-1',
        items: [
          {
            eventId: support.id,
            sessionId: 'session-1',
            participantId: 'candidate-1',
            bundle: 'claim',
            signalName: 'email_domain_match',
            healthStatus: 'OK',
            classification: 'SUPPORTS',
            occurredAt: T0,
          },
          {
            eventId: contradict.id,
            sessionId: 'session-1',
            participantId: 'candidate-1',
            bundle: 'claim',
            signalName: 'display_name_match',
            healthStatus: 'OK',
            classification: 'CONTRADICTS',
            occurredAt: T0,
          },
        ],
      },
    ]);

    const metrics = computeSessionContradictionMetrics(
      classified,
      indexEvidenceEvents([support, contradict]),
    );

    const report = engine.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'POSSIBLE_CANDIDATE',
      posterior: posterior(),
      events: [support, contradict],
      generatedAt: T0,
      contradictionMetrics: metrics,
      classification: classified,
      topParticipantId: 'candidate-1',
    });

    const reasoning = report.summary.contradictionReasoning;
    const participant = metrics.byParticipant[0]!;

    expect(reasoning).not.toBeNull();
    expect(reasoning?.agreementScore).toBe(participant.agreementScore);
    expect(reasoning?.contradictionScore).toBe(participant.contradictionScore);
    expect(reasoning?.consistencyScore).toBe(participant.consistencyScore);
    expect(reasoning?.strongestContradictions[0]).toBe(participant.contradictions[0]);
    expect(reasoning?.participantId).toBe('candidate-1');
  });
});
