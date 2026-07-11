import type { EvidenceEvent } from '@sherlock/contracts';
import { describe, expect, it } from 'vitest';

import { UNSCOPED_PARTICIPANT_ID } from '../evidenceClassification/index.js';
import { buildParticipantClassification, buildSessionEvidenceClassification } from '../evidenceClassification/index.js';
import { computeSessionContradictionMetrics, indexEvidenceEvents } from './contradictionMetrics.js';
import { computeSessionCrossModalMetrics } from './crossModalConsistency.js';

const T0 = new Date('2026-01-01T10:00:00.000Z');
const PARTICIPANT = 'candidate-1';

function event(overrides: Partial<EvidenceEvent> = {}): EvidenceEvent {
  return {
    id: 'event-1',
    sessionId: 'session-1',
    bundle: 'claim',
    signalName: 'display_name_match',
    healthStatus: 'OK',
    value: { matched: true, observedValue: 'Jane', claimedValue: 'Jane' },
    occurredAt: T0,
    recordedAt: T0,
    metadata: null,
    ...overrides,
  };
}

function faceEvent(similarity: number, id = 'face-1'): EvidenceEvent {
  return event({
    id,
    bundle: 'visual',
    signalName: 'face_embedding_self_consistency',
    value: { similarity, isFirstObservation: false },
  });
}

function voiceEvent(similarity: number, id = 'voice-1'): EvidenceEvent {
  return event({
    id,
    bundle: 'audio',
    signalName: 'voice_embedding_self_consistency',
    value: { similarity, isFirstObservation: false },
  });
}

function metadataClaimEvent(
  signalName: 'display_name_match' | 'email_domain_match' | 'calendar_invite_match',
  matched: boolean,
  confidence = 0.9,
): EvidenceEvent {
  return event({
    id: `${signalName}-${matched ? 'ok' : 'bad'}`,
    signalName,
    value: {
      matched,
      observedValue: 'Jane Doe',
      claimedValue: matched ? 'Jane Doe' : 'Other Person',
      confidence,
      similarity: confidence,
    },
  });
}

function transcriptEvent(consistent: boolean | null, id = 'transcript-1'): EvidenceEvent {
  return event({
    id,
    bundle: 'linguistic',
    signalName: 'biographical_claim_consistency',
    healthStatus: consistent === null ? 'NO_SIGNAL_DETECTED' : 'OK',
    value: { consistent, claimTopic: 'employer' },
  });
}

function evaluate(events: EvidenceEvent[]) {
  const classification = buildSessionEvidenceClassification('session-1', T0, [
    buildParticipantClassification(PARTICIPANT, events),
  ]);
  const eventsById = indexEvidenceEvents(events);
  const contradictionMetrics = computeSessionContradictionMetrics(classification, eventsById);
  return computeSessionCrossModalMetrics(classification, eventsById, contradictionMetrics);
}

describe('computeSessionCrossModalMetrics', () => {
  it('high consistency when face, speaker, and metadata all align', () => {
    const metrics = evaluate([
      faceEvent(0.92),
      voiceEvent(0.88),
      metadataClaimEvent('display_name_match', true),
      metadataClaimEvent('email_domain_match', true),
      transcriptEvent(true),
    ]);

    const row = metrics.byParticipant[0]!;
    expect(row.crossModalConsistency).toBeGreaterThan(0.9);
    expect(row.crossModalDisagreement).toBe(0);
    expect(row.crossModalConfidence).toBeGreaterThan(0.5);
    expect(row.modalities.find((modality) => modality.modality === 'face')?.stance).toBe('ALIGNED');
    expect(row.modalities.find((modality) => modality.modality === 'speaker')?.stance).toBe('ALIGNED');
    expect(row.modalities.find((modality) => modality.modality === 'metadata')?.stance).toBe('ALIGNED');
    expect(row.modalities.find((modality) => modality.modality === 'transcript')?.stance).toBe('ALIGNED');
  });

  it('high disagreement when face and speaker identity diverge', () => {
    const metrics = evaluate([faceEvent(0.92), voiceEvent(0.2)]);

    const row = metrics.byParticipant[0]!;
    expect(row.crossModalDisagreement).toBe(1);
    expect(row.crossModalConsistency).toBe(0);
    expect(row.modalities.find((modality) => modality.modality === 'face')?.stance).toBe('ALIGNED');
    expect(row.modalities.find((modality) => modality.modality === 'speaker')?.stance).toBe(
      'CONTRADICTING',
    );
  });

  it('partial consistency when biometrics align but metadata identity is unknown', () => {
    const metrics = evaluate([faceEvent(0.9), voiceEvent(0.86)]);

    const row = metrics.byParticipant[0]!;
    expect(row.crossModalDisagreement).toBe(0);
    expect(row.crossModalConsistency).toBeCloseTo(0.5, 1);
    expect(row.modalities.find((modality) => modality.modality === 'metadata')?.stance).toBe(
      'UNKNOWN',
    );
  });

  it('mixed evidence when metadata contradicts aligned biometrics', () => {
    const metrics = evaluate([
      faceEvent(0.91),
      voiceEvent(0.87),
      metadataClaimEvent('display_name_match', false, 0.8),
    ]);

    const row = metrics.byParticipant[0]!;
    expect(row.crossModalDisagreement).toBeGreaterThan(0);
    expect(row.crossModalConsistency).toBeGreaterThan(0);
    expect(row.crossModalConsistency).toBeLessThan(0.75);
    expect(row.modalities.find((modality) => modality.modality === 'metadata')?.stance).toBe(
      'CONTRADICTING',
    );
  });

  it('missing evidence yields unknown modalities and low confidence', () => {
    const metrics = evaluate([]);

    const row = metrics.byParticipant[0]!;
    expect(row.crossModalConfidence).toBe(0);
    expect(row.crossModalConsistency).toBe(1);
    expect(row.crossModalDisagreement).toBe(0);
    expect(row.modalities.every((modality) => modality.stance === 'UNKNOWN')).toBe(true);
  });

  it('reuses contradiction metrics without recomputing consistency scores', () => {
    const events = [faceEvent(0.9), voiceEvent(0.88), metadataClaimEvent('email_domain_match', true)];
    const classification = buildSessionEvidenceClassification('session-1', T0, [
      buildParticipantClassification(UNSCOPED_PARTICIPANT_ID, events),
    ]);
    const eventsById = indexEvidenceEvents(events);
    const contradictionMetrics = computeSessionContradictionMetrics(classification, eventsById);
    const crossModal = computeSessionCrossModalMetrics(classification, eventsById, contradictionMetrics);

    const contradictionRow = contradictionMetrics.byParticipant[0]!;
    const crossModalRow = crossModal.byParticipant[0]!;
    const expectedConsistency = 0.75 * contradictionRow.consistencyScore;

    expect(crossModalRow.crossModalConsistency).toBeCloseTo(expectedConsistency, 5);
    expect(crossModalRow.crossModalConfidence).toBeCloseTo(
      crossModalRow.modalities
        .filter((modality) => modality.stance !== 'UNKNOWN')
        .reduce((sum, modality) => sum + modality.confidence, 0) /
        3 *
        contradictionRow.agreementScore,
      5,
    );
  });
});
