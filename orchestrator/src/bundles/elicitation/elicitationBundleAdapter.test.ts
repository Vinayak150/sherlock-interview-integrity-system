import { describe, expect, it } from 'vitest';

import { ElicitationBundleAdapter } from './elicitationBundleAdapter.js';

const OCCURRED_AT = new Date('2026-07-10T12:00:00.000Z');

describe('ElicitationBundleAdapter', () => {
  const adapter = new ElicitationBundleAdapter();

  it('reports OK with satisfied=true when the challenge was met', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      { challengeType: 'repeat_phrase', satisfied: true },
      OCCURRED_AT,
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      bundle: 'elicitation',
      signalName: 'active_elicitation_response',
      healthStatus: 'OK',
      value: { challengeType: 'repeat_phrase', satisfied: true },
    });
  });

  it('reports OK with satisfied=false when the challenge was not met', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      { challengeType: 'camera_reposition', satisfied: false },
      OCCURRED_AT,
    );

    expect(events[0]).toMatchObject({ healthStatus: 'OK', value: { satisfied: false } });
  });

  it('reports NO_SIGNAL_DETECTED when no response was captured (satisfied: null)', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      { challengeType: 'unscripted_statement', satisfied: null },
      OCCURRED_AT,
    );

    expect(events[0]).toMatchObject({
      healthStatus: 'NO_SIGNAL_DETECTED',
      value: { satisfied: null },
    });
  });

  it('tags the event with sessionId and occurredAt', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      { challengeType: 'repeat_phrase', satisfied: true },
      OCCURRED_AT,
    );
    expect(events[0]?.sessionId).toBe('session-1');
    expect(events[0]?.occurredAt).toBe(OCCURRED_AT);
  });
});
