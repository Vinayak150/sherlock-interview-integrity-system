import type { EvidenceEvent } from '@sherlock/contracts';
import { describe, expect, it } from 'vitest';

import { FusionEngine } from '../fusion/index.js';
import { runAblation } from './ablationRunner.js';

const T0 = new Date('2026-07-10T12:00:00.000Z');
let nextId = 0;

function event(overrides: Partial<EvidenceEvent> = {}): EvidenceEvent {
  nextId += 1;
  return {
    id: `00000000-0000-0000-0000-${String(nextId).padStart(12, '0')}`,
    sessionId: 'session-1',
    bundle: 'claim',
    signalName: 'email_domain_match',
    healthStatus: 'OK',
    value: { matched: true },
    occurredAt: T0,
    recordedAt: T0,
    metadata: null,
    ...overrides,
  };
}

describe('runAblation', () => {
  it('returns one result per bundle actually present in the event set', () => {
    const events = [
      event({ bundle: 'claim', signalName: 'email_domain_match', value: { matched: true } }),
      event({ bundle: 'metadata', signalName: 'calendar_invite_match', value: { matched: true } }),
    ];

    const results = runAblation(new FusionEngine(), 'session-1', events, T0);

    expect(results.map((r) => r.excludedBundle).sort()).toEqual(['claim', 'metadata']);
  });

  it('a bundle contributing SUPPORTS shows a positive probabilityDelta', () => {
    const events = [
      event({ bundle: 'claim', signalName: 'email_domain_match', value: { matched: true } }),
      event({ bundle: 'metadata', signalName: 'calendar_invite_match', value: { matched: true } }),
    ];

    const results = runAblation(new FusionEngine(), 'session-1', events, T0);
    const claimResult = results.find((r) => r.excludedBundle === 'claim');

    expect(claimResult?.probabilityDelta).toBeGreaterThan(0);
  });

  it('near-zero-weighted Device signals (ADR-16) produce a near-zero delta even with heavy activity', () => {
    const events = [
      event({ bundle: 'claim', signalName: 'email_domain_match', value: { matched: true } }),
      event({
        bundle: 'device',
        signalName: 'clipboard_paste',
        value: { count: 20, windowMs: 60_000 },
      }),
    ];

    const results = runAblation(new FusionEngine(), 'session-1', events, T0);
    const deviceResult = results.find((r) => r.excludedBundle === 'device');

    expect(Math.abs(deviceResult?.probabilityDelta ?? 1)).toBeLessThan(0.01);
  });

  it('reports the correct eventCountRemoved for the ablated bundle', () => {
    const events = [
      event({ bundle: 'claim', signalName: 'email_domain_match', value: { matched: true } }),
      event({ bundle: 'claim', signalName: 'display_name_match', value: { matched: true } }),
      event({ bundle: 'metadata', signalName: 'calendar_invite_match', value: { matched: true } }),
    ];

    const results = runAblation(new FusionEngine(), 'session-1', events, T0);
    const claimResult = results.find((r) => r.excludedBundle === 'claim');

    expect(claimResult?.eventCountRemoved).toBe(2);
  });

  it('returns an empty array for a session with no events', () => {
    expect(runAblation(new FusionEngine(), 'session-1', [], T0)).toEqual([]);
  });
});
