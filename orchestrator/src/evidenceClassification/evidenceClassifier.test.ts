import type { EvidenceEvent } from '@sherlock/contracts';
import { describe, expect, it } from 'vitest';

import {
  UNSCOPED_PARTICIPANT_ID,
  buildSessionEvidenceClassification,
  classifyEvidenceEvent,
  classifyEvidenceLedger,
} from './evidenceClassifier.js';

const T0 = new Date('2026-07-10T12:00:00.000Z');

function event(overrides: Partial<EvidenceEvent> = {}): EvidenceEvent {
  return {
    id: '00000000-0000-0000-0000-000000000001',
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

describe('classifyEvidenceEvent', () => {
  it('classifies a supporting claim signal as SUPPORTS for a participant hypothesis', () => {
    const item = classifyEvidenceEvent(event(), 'candidate-1');
    expect(item.classification).toBe('SUPPORTS');
    expect(item.participantId).toBe('candidate-1');
    expect(item.bundle).toBe('claim');
  });

  it('classifies a contradicting claim signal as CONTRADICTS', () => {
    const item = classifyEvidenceEvent(
      event({ value: { matched: false, observedValue: 'a', claimedValue: 'b' } }),
      'candidate-1',
    );
    expect(item.classification).toBe('CONTRADICTS');
  });

  it('classifies missing evidence as NEUTRAL, never CONTRADICTS', () => {
    const item = classifyEvidenceEvent(
      event({
        healthStatus: 'NO_SIGNAL_DETECTED',
        value: { matched: false, observedValue: null, claimedValue: null },
      }),
      'candidate-1',
    );
    expect(item.classification).toBe('NEUTRAL');
  });

  it('classifies service-unavailable evidence as NEUTRAL', () => {
    const item = classifyEvidenceEvent(
      event({
        healthStatus: 'SERVICE_UNAVAILABLE',
        value: { reason: 'ATS down' },
      }),
      'candidate-1',
    );
    expect(item.classification).toBe('NEUTRAL');
  });

  it('classifies every item in a ledger for one participant', () => {
    const ledger = classifyEvidenceLedger(
      [
        event({ id: '00000000-0000-0000-0000-000000000001' }),
        event({
          id: '00000000-0000-0000-0000-000000000002',
          signalName: 'display_name_match',
          value: { matched: false, observedValue: 'a', claimedValue: 'b' },
        }),
      ],
      'candidate-1',
      'session-1',
    );

    expect(ledger).toHaveLength(2);
    expect(ledger.map((item) => item.classification)).toEqual(['SUPPORTS', 'CONTRADICTS']);
  });

  it('builds a session classification table grouped by participant', () => {
    const table = buildSessionEvidenceClassification('session-1', T0, [
      {
        participantId: 'candidate-1',
        items: [classifyEvidenceEvent(event(), 'candidate-1')],
      },
      {
        participantId: 'candidate-2',
        items: [
          classifyEvidenceEvent(
            event({ value: { matched: false, observedValue: 'a', claimedValue: 'b' } }),
            'candidate-2',
          ),
        ],
      },
    ]);

    expect(table.sessionId).toBe('session-1');
    expect(table.byParticipant).toHaveLength(2);
    expect(table.byParticipant[0]?.items[0]?.classification).toBe('SUPPORTS');
    expect(table.byParticipant[1]?.items[0]?.classification).toBe('CONTRADICTS');
  });

  it('uses UNSCOPED_PARTICIPANT_ID for sessions without a hypothesis pool', () => {
    const item = classifyEvidenceEvent(event(), UNSCOPED_PARTICIPANT_ID);
    expect(item.participantId).toBe(UNSCOPED_PARTICIPANT_ID);
  });
});
