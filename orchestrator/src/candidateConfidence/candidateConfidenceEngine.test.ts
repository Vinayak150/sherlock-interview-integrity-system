import type { EvidenceEvent } from '@sherlock/contracts';
import { describe, expect, it } from 'vitest';

import { ClaimBundleAdapter } from '../bundles/claim/claimBundleAdapter.js';
import { InMemoryAtsClient } from '../bundles/claim/atsClient.js';
import { FusionEngine } from '../fusion/index.js';
import { CandidateConfidenceEngine } from './candidateConfidenceEngine.js';

const T0 = new Date('2026-01-01T10:00:00.000Z');

function atsRecord(candidateId: string) {
  return {
    candidateId,
    applicationName: 'Jane Doe',
    applicationEmail: 'jane@acme.com',
    calendarInviteAttendeeEmail: 'jane@acme.com',
    hasReferencePhoto: true,
    hasPriorIdVerification: true,
    hasAccountHistory: true,
  };
}

function claimEvent(
  overrides: Partial<EvidenceEvent> & Pick<EvidenceEvent, 'signalName' | 'value'>,
): EvidenceEvent {
  return {
    id: crypto.randomUUID(),
    sessionId: 'session-1',
    bundle: 'claim',
    healthStatus: 'OK',
    recordedAt: T0,
    occurredAt: T0,
    metadata: null,
    ...overrides,
  };
}

function metadataEvent(signalName: string, value: unknown): EvidenceEvent {
  return {
    id: crypto.randomUUID(),
    sessionId: 'session-1',
    bundle: 'metadata',
    signalName,
    healthStatus: 'OK',
    value,
    recordedAt: T0,
    occurredAt: T0,
    metadata: null,
  };
}

function buildEngine(atsClient: InMemoryAtsClient) {
  const claimAdapter = new ClaimBundleAdapter(atsClient);
  return {
    claimAdapter,
    engine: new CandidateConfidenceEngine(new FusionEngine(), claimAdapter),
  };
}

describe('CandidateConfidenceEngine', () => {
  it('uses session-wide fusion when no participant pool exists yet', async () => {
    const ats = new InMemoryAtsClient();
    ats.seed(atsRecord('candidate-1'));
    const { engine } = buildEngine(ats);

    const events = [
      metadataEvent('join_method', { method: 'direct_link', joinOrder: 1 }),
    ] as EvidenceEvent[];

    const result = await engine.evaluate('session-1', events, T0);
    expect(result.table.rankedCandidates).toHaveLength(0);
    expect(result.selectedPosterior.sessionId).toBe('session-1');
  });

  it('keeps single-participant posterior identical to full-ledger fusion', async () => {
    const ats = new InMemoryAtsClient();
    ats.seed(atsRecord('candidate-1'));
    const { engine } = buildEngine(ats);

    engine.recordClaimObservation(
      'session-1',
      {
        candidateId: 'candidate-1',
        displayName: 'Jane Doe',
        joinEmail: 'jane@acme.com',
        calendarAttendeeEmail: 'jane@acme.com',
      },
      [],
    );

    const events = [
      claimEvent({
        signalName: 'display_name_match',
        value: { matched: true, observedValue: 'Jane Doe', claimedValue: 'Jane Doe' },
      }),
      claimEvent({
        signalName: 'email_domain_match',
        value: { matched: true, observedValue: 'jane@acme.com', claimedValue: 'jane@acme.com' },
      }),
      metadataEvent('join_method', { method: 'direct_link', joinOrder: 1 }),
    ] as EvidenceEvent[];

    const fusion = new FusionEngine();
    const expected = fusion.computePosterior('session-1', events, T0);
    const result = await engine.evaluate('session-1', events, T0);

    expect(result.selectedPosterior.probability).toBe(expected.probability);
    expect(result.table.rankedCandidates).toHaveLength(1);
    expect(result.table.topParticipantId).toBe('candidate-1');
    expect(result.table.rankedCandidates[0]?.topEvidenceContributors.length).toBeGreaterThan(0);
    expect(result.classification.byParticipant).toHaveLength(1);
    expect(result.classification.byParticipant[0]?.participantId).toBe('candidate-1');
    expect(result.classification.byParticipant[0]?.items.length).toBeGreaterThan(0);
    expect(
      result.classification.byParticipant[0]?.items.every((item) =>
        ['SUPPORTS', 'CONTRADICTS', 'NEUTRAL'].includes(item.classification),
      ),
    ).toBe(true);

    expect(result.contradictionMetrics.byParticipant[0]?.agreementScore).toBeGreaterThan(0);
    expect(result.contradictionMetrics.byParticipant[0]?.contradictionScore).toBe(0);
    expect(result.crossModalMetrics.byParticipant[0]?.crossModalConsistency).toBeGreaterThan(0);
  });

  it('ranks multiple ATS candidates and prefers the best-matching hypothesis', async () => {
    const ats = new InMemoryAtsClient();
    ats.seed(atsRecord('candidate-1'));
    ats.seed({
      ...atsRecord('candidate-2'),
      applicationName: 'John Smith',
      applicationEmail: 'john@other.com',
      calendarInviteAttendeeEmail: 'john@other.com',
    });
    const { engine } = buildEngine(ats);

    engine.recordClaimObservation(
      'session-1',
      {
        candidateId: 'candidate-1',
        displayName: 'Jane Doe',
        joinEmail: 'jane@acme.com',
        calendarAttendeeEmail: 'jane@acme.com',
      },
      ats.listCandidateIds(),
    );

    const events = [
      metadataEvent('join_method', { method: 'direct_link', joinOrder: 1 }),
    ] as EvidenceEvent[];

    const result = await engine.evaluate('session-1', events, T0);

    expect(result.table.rankedCandidates).toHaveLength(2);
    expect(result.table.topParticipantId).toBe('candidate-1');
    expect(result.table.rankedCandidates[0]?.participantId).toBe('candidate-1');
    expect(result.table.rankedCandidates[0]!.probability).toBeGreaterThan(
      result.table.rankedCandidates[1]!.probability,
    );
    expect(result.selectedPosterior.probability).toBe(
      result.table.rankedCandidates[0]!.probability,
    );

    const candidateOneClaim = result.classification.byParticipant.find(
      (row) => row.participantId === 'candidate-1',
    );
    const candidateTwoClaim = result.classification.byParticipant.find(
      (row) => row.participantId === 'candidate-2',
    );
    expect(candidateOneClaim?.items.some((item) => item.classification === 'SUPPORTS')).toBe(true);
    expect(candidateTwoClaim?.items.some((item) => item.classification === 'CONTRADICTS')).toBe(
      true,
    );

    const candidateOneMetrics = result.contradictionMetrics.byParticipant.find(
      (row) => row.participantId === 'candidate-1',
    );
    const candidateTwoMetrics = result.contradictionMetrics.byParticipant.find(
      (row) => row.participantId === 'candidate-2',
    );
    expect(candidateOneMetrics?.contradictionScore ?? 1).toBeLessThan(
      candidateTwoMetrics?.contradictionScore ?? 0,
    );
    const candidateTwoContradiction = candidateTwoMetrics?.contradictions.find(
      (record) => record.conflictingParticipantId !== null,
    );
    expect(candidateTwoContradiction?.conflictingParticipantId).toBe('candidate-1');
  });

  it('marks participants below the abstention threshold as UNKNOWN', async () => {
    const ats = new InMemoryAtsClient();
    ats.seed(atsRecord('candidate-1'));
    const { engine } = buildEngine(ats);

    engine.recordClaimObservation(
      'session-1',
      {
        candidateId: 'candidate-1',
        displayName: 'Totally Different',
        joinEmail: 'wrong@evil.com',
        calendarAttendeeEmail: 'wrong@evil.com',
      },
      [],
    );

    const events = [
      claimEvent({
        signalName: 'display_name_match',
        value: {
          matched: false,
          observedValue: 'Totally Different',
          claimedValue: 'Jane Doe',
        },
      }),
      claimEvent({
        signalName: 'email_domain_match',
        value: {
          matched: false,
          observedValue: 'wrong@evil.com',
          claimedValue: 'jane@acme.com',
        },
      }),
    ] as EvidenceEvent[];

    const result = await engine.evaluate('session-1', events, T0);
    const row = result.table.rankedCandidates[0];
    expect(row?.identificationState).toBe('UNKNOWN');
    expect(row!.probability).toBeLessThan(0.55);
  });

  it('decays stale evidence so older contributors weigh less over time', async () => {
    const ats = new InMemoryAtsClient();
    ats.seed(atsRecord('candidate-1'));
    const { engine } = buildEngine(ats);

    engine.recordClaimObservation(
      'session-1',
      {
        candidateId: 'candidate-1',
        displayName: 'Jane Doe',
        joinEmail: 'jane@acme.com',
        calendarAttendeeEmail: 'jane@acme.com',
      },
      [],
    );

    const oldTime = new Date('2026-01-01T10:00:00.000Z');
    const freshTime = new Date('2026-01-01T12:00:00.000Z');
    const events = [
      claimEvent({
        signalName: 'display_name_match',
        occurredAt: oldTime,
        value: { matched: true, observedValue: 'Jane Doe', claimedValue: 'Jane Doe' },
      }),
    ] as EvidenceEvent[];

    const early = await engine.evaluate('session-1', events, oldTime);
    const later = await engine.evaluate('session-1', events, freshTime);

    expect(later.selectedPosterior.probability).toBeLessThan(early.selectedPosterior.probability);
    expect(later.table.rankedCandidates[0]!.uncertainty).toBeGreaterThanOrEqual(
      early.table.rankedCandidates[0]!.uncertainty,
    );
  });

  it('handles missing claim evidence gracefully via NO_SIGNAL_DETECTED neutrality', async () => {
    const ats = new InMemoryAtsClient();
    ats.seed(atsRecord('candidate-1'));
    const { engine } = buildEngine(ats);

    engine.recordClaimObservation(
      'session-1',
      {
        candidateId: 'candidate-1',
        displayName: null,
        joinEmail: null,
        calendarAttendeeEmail: null,
      },
      [],
    );

    const events = [
      claimEvent({
        signalName: 'display_name_match',
        healthStatus: 'NO_SIGNAL_DETECTED',
        value: { matched: false, observedValue: null, claimedValue: 'Jane Doe' },
      }),
    ] as EvidenceEvent[];

    const result = await engine.evaluate('session-1', events, T0);
    expect(result.selectedPosterior.probability).toBeCloseTo(0.5, 5);
    expect(result.table.rankedCandidates[0]?.identificationState).toBe('UNKNOWN');
  });

  it('attaches cross-modal metrics to ranked candidates and exposes them on evaluation', async () => {
    const ats = new InMemoryAtsClient();
    ats.seed(atsRecord('candidate-1'));
    const { engine } = buildEngine(ats);

    engine.recordClaimObservation(
      'session-1',
      {
        candidateId: 'candidate-1',
        displayName: 'Jane Doe',
        joinEmail: 'jane@acme.com',
        calendarAttendeeEmail: 'jane@acme.com',
      },
      [],
    );

    const events = [
      {
        id: crypto.randomUUID(),
        sessionId: 'session-1',
        bundle: 'visual',
        signalName: 'face_embedding_self_consistency',
        healthStatus: 'OK',
        value: { similarity: 0.92, isFirstObservation: false },
        recordedAt: T0,
        occurredAt: T0,
        metadata: null,
      },
      {
        id: crypto.randomUUID(),
        sessionId: 'session-1',
        bundle: 'audio',
        signalName: 'voice_embedding_self_consistency',
        healthStatus: 'OK',
        value: { similarity: 0.88, isFirstObservation: false },
        recordedAt: T0,
        occurredAt: T0,
        metadata: null,
      },
      claimEvent({
        signalName: 'display_name_match',
        value: { matched: true, observedValue: 'Jane Doe', claimedValue: 'Jane Doe', confidence: 0.95 },
      }),
    ] as EvidenceEvent[];

    const result = await engine.evaluate('session-1', events, T0);
    const row = result.table.rankedCandidates[0];

    expect(row?.crossModal).not.toBeNull();
    expect(row?.crossModal?.crossModalConsistency).toBeGreaterThan(0.7);
    expect(result.crossModalMetrics.byParticipant[0]?.participantId).toBe('candidate-1');
  });
});
