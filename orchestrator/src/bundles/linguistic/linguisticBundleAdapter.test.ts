import { describe, expect, it } from 'vitest';

import { LinguisticBundleAdapter } from './linguisticBundleAdapter.js';

const OCCURRED_AT = new Date('2026-07-10T12:00:00.000Z');

describe('LinguisticBundleAdapter', () => {
  const adapter = new LinguisticBundleAdapter();

  it('reports OK with consistent=true for a matching biographical claim', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      {
        claims: [{ claimTopic: 'employer', observedValue: 'Acme Corp', claimedValue: 'acme corp' }],
      },
      OCCURRED_AT,
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      bundle: 'linguistic',
      signalName: 'biographical_claim_consistency',
      healthStatus: 'OK',
      value: { consistent: true, claimTopic: 'employer' },
    });
  });

  it('reports OK with consistent=false for a genuine mismatch', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      {
        claims: [
          { claimTopic: 'school', observedValue: 'State University', claimedValue: 'City College' },
        ],
      },
      OCCURRED_AT,
    );

    expect(events[0]).toMatchObject({ healthStatus: 'OK', value: { consistent: false } });
  });

  it('reports NO_SIGNAL_DETECTED, not a mismatch, when one side of the comparison is absent', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      { claims: [{ claimTopic: 'employer', observedValue: null, claimedValue: 'Acme Corp' }] },
      OCCURRED_AT,
    );

    expect(events[0]).toMatchObject({
      healthStatus: 'NO_SIGNAL_DETECTED',
      value: { consistent: null, claimTopic: 'employer' },
    });
  });

  it('handles multiple claim topics independently in one call', () => {
    const events = adapter.buildEvidenceEvents(
      'session-1',
      {
        claims: [
          { claimTopic: 'employer', observedValue: 'Acme', claimedValue: 'Acme' },
          { claimTopic: 'school', observedValue: 'A', claimedValue: 'B' },
        ],
      },
      OCCURRED_AT,
    );

    expect(events).toHaveLength(2);
    expect(events[0]?.value).toMatchObject({ consistent: true });
    expect(events[1]?.value).toMatchObject({ consistent: false });
  });

  it('returns an empty array for no claims', () => {
    const events = adapter.buildEvidenceEvents('session-1', { claims: [] }, OCCURRED_AT);
    expect(events).toHaveLength(0);
  });
});
