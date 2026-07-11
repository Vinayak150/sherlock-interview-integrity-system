import type { EvidenceEvent } from '@sherlock/contracts';
import { describe, expect, it } from 'vitest';

import type { SessionEvidenceClassification } from '../evidenceClassification/index.js';
import { DEFAULT_HALF_LIFE_MS } from '../fusion/index.js';
import {
  computeSessionContradictionMetrics,
  indexEvidenceEvents,
} from './contradictionMetrics.js';

const T0 = new Date('2026-01-01T10:00:00.000Z');

function event(overrides: Partial<EvidenceEvent> = {}): EvidenceEvent {
  return {
    id: 'event-1',
    sessionId: 'session-1',
    bundle: 'claim',
    signalName: 'email_domain_match',
    healthStatus: 'OK',
    value: { matched: false, observedValue: 'a', claimedValue: 'b' },
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

describe('computeSessionContradictionMetrics', () => {
  it('computes agreement, contradiction, and consistency scores from classifications', () => {
    const supportEvent = event({
      id: 'support-1',
      value: { matched: true, observedValue: 'a', claimedValue: 'a' },
    });
    const contradictEvent = event({
      id: 'contradict-1',
      signalName: 'display_name_match',
      value: { matched: false, observedValue: 'a', claimedValue: 'b' },
    });

    const metrics = computeSessionContradictionMetrics(
      classification([
        {
          participantId: 'candidate-1',
          items: [
            {
              eventId: supportEvent.id,
              sessionId: 'session-1',
              participantId: 'candidate-1',
              bundle: 'claim',
              signalName: 'email_domain_match',
              healthStatus: 'OK',
              classification: 'SUPPORTS',
              occurredAt: T0,
            },
            {
              eventId: contradictEvent.id,
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
      ]),
      indexEvidenceEvents([supportEvent, contradictEvent]),
    );

    const row = metrics.byParticipant[0]!;
    expect(row.agreementScore).toBeCloseTo(0.5, 5);
    expect(row.contradictionScore).toBeCloseTo(0.5, 5);
    expect(row.consistencyScore).toBeCloseTo(0.5, 5);
    expect(row.contradictions).toHaveLength(1);
    expect(row.contradictions[0]).toMatchObject({
      participantId: 'candidate-1',
      severity: 'LOW',
      evidenceSource: {
        bundle: 'claim',
        signalName: 'display_name_match',
        eventId: 'contradict-1',
      },
    });
  });

  it('records severity and confidence from signal magnitude', () => {
    const strongContradiction = event({
      id: 'strong-1',
      bundle: 'metadata',
      signalName: 'virtual_capture_device_detected',
      value: { detected: true },
    });

    const metrics = computeSessionContradictionMetrics(
      classification([
        {
          participantId: 'candidate-1',
          items: [
            {
              eventId: strongContradiction.id,
              sessionId: 'session-1',
              participantId: 'candidate-1',
              bundle: 'metadata',
              signalName: 'virtual_capture_device_detected',
              healthStatus: 'OK',
              classification: 'CONTRADICTS',
              occurredAt: T0,
            },
          ],
        },
      ]),
      indexEvidenceEvents([strongContradiction]),
    );

    const contradiction = metrics.byParticipant[0]?.contradictions[0];
    expect(contradiction?.severity).toBe('HIGH');
    expect(contradiction?.confidence).toBeGreaterThan(0.8);
    expect(contradiction?.timestamp).toBe(T0);
  });

  it('detects a conflicting participant when another hypothesis is supported on the same signal', () => {
    const sharedTime = T0.getTime();
    const metrics = computeSessionContradictionMetrics(
      classification([
        {
          participantId: 'candidate-1',
          items: [
            {
              eventId: 'claim-1',
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
        {
          participantId: 'candidate-2',
          items: [
            {
              eventId: 'claim-2',
              sessionId: 'session-1',
              participantId: 'candidate-2',
              bundle: 'claim',
              signalName: 'email_domain_match',
              healthStatus: 'OK',
              classification: 'SUPPORTS',
              occurredAt: new Date(sharedTime),
            },
          ],
        },
      ]),
      indexEvidenceEvents([
        event({ id: 'claim-1', value: { matched: false } }),
        event({ id: 'claim-2', value: { matched: true } }),
      ]),
    );

    expect(metrics.byParticipant[0]?.contradictions[0]?.conflictingParticipantId).toBe(
      'candidate-2',
    );
  });

  it('decays contradiction influence over time using the fusion freshness model', () => {
    const contradictEvent = event({ id: 'decay-1' });
    const classified = classification(
      [
        {
          participantId: 'candidate-1',
          items: [
            {
              eventId: contradictEvent.id,
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
      new Date(T0.getTime() + DEFAULT_HALF_LIFE_MS),
    );

    const fresh = computeSessionContradictionMetrics(
      classification(classified.byParticipant.map((row) => ({ ...row })), T0),
      indexEvidenceEvents([contradictEvent]),
    );
    const stale = computeSessionContradictionMetrics(
      classified,
      indexEvidenceEvents([contradictEvent]),
    );

    expect(stale.byParticipant[0]?.contradictions[0]?.decayWeight).toBeCloseTo(0.5, 5);
    expect(stale.byParticipant[0]?.contradictions[0]?.confidence).toBeCloseTo(
      (fresh.byParticipant[0]?.contradictions[0]?.confidence ?? 0) / 2,
      5,
    );
    expect(stale.byParticipant[0]?.contradictionScore).toBe(1);
  });

  it('ignores NEUTRAL classifications in score denominators', () => {
    const metrics = computeSessionContradictionMetrics(
      classification([
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
      ]),
      new Map(),
    );

    expect(metrics.byParticipant[0]?.agreementScore).toBe(1);
    expect(metrics.byParticipant[0]?.contradictionScore).toBe(0);
    expect(metrics.byParticipant[0]?.contradictions).toHaveLength(0);
  });
});
