import type { NewEvidenceEvent } from '@sherlock/contracts';
import { describe, expect, it } from 'vitest';

import {
  ColdStartStateManager,
  evaluateColdStartTransition,
  hasWeakClaimMatchEvidence,
} from './coldStart.js';

const OCCURRED_AT = new Date('2026-07-10T12:00:00.000Z');

function claimEvent(overrides: Partial<NewEvidenceEvent> = {}): NewEvidenceEvent {
  return {
    sessionId: 'session-1',
    bundle: 'claim',
    signalName: 'display_name_match',
    healthStatus: 'OK',
    value: { matched: true, observedValue: 'Jane Doe', claimedValue: 'Jane Doe' },
    occurredAt: OCCURRED_AT,
    metadata: null,
    ...overrides,
  };
}

describe('hasWeakClaimMatchEvidence', () => {
  it('is true when an OK claim-match signal reports a match', () => {
    expect(hasWeakClaimMatchEvidence([claimEvent()])).toBe(true);
  });

  it('is false when the claim-match signal reports no match', () => {
    expect(
      hasWeakClaimMatchEvidence([
        claimEvent({ value: { matched: false, observedValue: 'a', claimedValue: 'b' } }),
      ]),
    ).toBe(false);
  });

  it('is false for an empty evidence list', () => {
    expect(hasWeakClaimMatchEvidence([])).toBe(false);
  });

  it('ignores SERVICE_UNAVAILABLE events even if their value looks like a match', () => {
    expect(
      hasWeakClaimMatchEvidence([
        claimEvent({ healthStatus: 'SERVICE_UNAVAILABLE', value: { reason: 'ATS unavailable' } }),
      ]),
    ).toBe(false);
  });

  it('ignores NO_SIGNAL_DETECTED events', () => {
    expect(
      hasWeakClaimMatchEvidence([
        claimEvent({
          healthStatus: 'NO_SIGNAL_DETECTED',
          value: { matched: false, observedValue: null, claimedValue: null },
        }),
      ]),
    ).toBe(false);
  });

  it('ignores presence-type claim signals (they carry no matched field semantics)', () => {
    expect(
      hasWeakClaimMatchEvidence([
        claimEvent({
          signalName: 'reference_photo_available',
          value: { available: true, reference: null },
        }),
      ]),
    ).toBe(false);
  });

  it('ignores evidence from a different bundle entirely', () => {
    expect(
      hasWeakClaimMatchEvidence([
        claimEvent({ bundle: 'metadata', signalName: 'join_method', value: { matched: true } }),
      ]),
    ).toBe(false);
  });

  it('is true when at least one of several signals matches, even if others do not', () => {
    expect(
      hasWeakClaimMatchEvidence([
        claimEvent({
          signalName: 'display_name_match',
          value: { matched: false, observedValue: 'a', claimedValue: 'b' },
        }),
        claimEvent({
          signalName: 'email_domain_match',
          value: { matched: true, observedValue: 'a', claimedValue: 'a' },
        }),
      ]),
    ).toBe(true);
  });
});

describe('evaluateColdStartTransition', () => {
  it('stays UNKNOWN with no claim evidence', () => {
    const result = evaluateColdStartTransition('UNKNOWN', []);
    expect(result).toMatchObject({ state: 'UNKNOWN', transitioned: false });
  });

  it('transitions UNKNOWN -> POSSIBLE_CANDIDATE on weak claim-match evidence', () => {
    const result = evaluateColdStartTransition('UNKNOWN', [claimEvent()]);
    expect(result).toMatchObject({ state: 'POSSIBLE_CANDIDATE', transitioned: true });
  });

  it('does not transition on a claim mismatch alone', () => {
    const result = evaluateColdStartTransition('UNKNOWN', [
      claimEvent({ value: { matched: false, observedValue: 'a', claimedValue: 'b' } }),
    ]);
    expect(result).toMatchObject({ state: 'UNKNOWN', transitioned: false });
  });

  it('is idempotent once already at POSSIBLE_CANDIDATE, regardless of subsequent evidence', () => {
    const result = evaluateColdStartTransition('POSSIBLE_CANDIDATE', []);
    expect(result).toMatchObject({ state: 'POSSIBLE_CANDIDATE', transitioned: false });
  });

  it('never regresses POSSIBLE_CANDIDATE back to UNKNOWN even given only mismatches', () => {
    const result = evaluateColdStartTransition('POSSIBLE_CANDIDATE', [
      claimEvent({ value: { matched: false, observedValue: 'a', claimedValue: 'b' } }),
    ]);
    expect(result.state).toBe('POSSIBLE_CANDIDATE');
  });
});

describe('ColdStartStateManager', () => {
  it('starts every unseen session at UNKNOWN (RFC §11 cold-start invariant)', () => {
    const manager = new ColdStartStateManager();
    expect(manager.getState('never-seen-session')).toBe('UNKNOWN');
  });

  it('transitions a session to POSSIBLE_CANDIDATE and remembers it on the next call', () => {
    const manager = new ColdStartStateManager();

    const result = manager.recordClaimEvidence('session-1', [claimEvent()]);

    expect(result).toMatchObject({ state: 'POSSIBLE_CANDIDATE', transitioned: true });
    expect(manager.getState('session-1')).toBe('POSSIBLE_CANDIDATE');
  });

  it('keeps sessions isolated from one another', () => {
    const manager = new ColdStartStateManager();

    manager.recordClaimEvidence('session-a', [claimEvent()]);

    expect(manager.getState('session-a')).toBe('POSSIBLE_CANDIDATE');
    expect(manager.getState('session-b')).toBe('UNKNOWN');
  });

  it('reports transitioned=false on a later call once already at POSSIBLE_CANDIDATE', () => {
    const manager = new ColdStartStateManager();
    manager.recordClaimEvidence('session-1', [claimEvent()]);

    const second = manager.recordClaimEvidence('session-1', []);

    expect(second).toMatchObject({ state: 'POSSIBLE_CANDIDATE', transitioned: false });
  });
});
