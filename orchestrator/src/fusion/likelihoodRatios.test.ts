import type { EvidenceEvent } from '@sherlock/contracts';
import { describe, expect, it } from 'vitest';

import { resolveSignalOutcome, signalLogLikelihoodRatio } from './likelihoodRatios.js';

const OCCURRED_AT = new Date('2026-07-10T12:00:00.000Z');

function event(overrides: Partial<EvidenceEvent> = {}): EvidenceEvent {
  return {
    id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    sessionId: 'session-1',
    bundle: 'claim',
    signalName: 'display_name_match',
    healthStatus: 'OK',
    value: { matched: true, observedValue: 'a', claimedValue: 'a' },
    occurredAt: OCCURRED_AT,
    recordedAt: OCCURRED_AT,
    metadata: null,
    ...overrides,
  };
}

describe('resolveSignalOutcome', () => {
  it('throws for a SERVICE_UNAVAILABLE event (must be filtered upstream, per RFC §13)', () => {
    expect(() => resolveSignalOutcome(event({ healthStatus: 'SERVICE_UNAVAILABLE' }))).toThrow();
  });

  it('resolves NEUTRAL for NO_SIGNAL_DETECTED regardless of the payload shape', () => {
    // Deliberately shaped like a mismatch (matched: false) to prove the health-status guard
    // takes priority over reading the value -- this is exactly the "absence coerced into a
    // negative" bug class RFC §7/§13 warn about.
    expect(
      resolveSignalOutcome(
        event({
          healthStatus: 'NO_SIGNAL_DETECTED',
          value: { matched: false, observedValue: null, claimedValue: null },
        }),
      ),
    ).toBe('NEUTRAL');
  });

  it('resolves SUPPORTS for a matched claim signal', () => {
    expect(resolveSignalOutcome(event({ value: { matched: true } }))).toBe('SUPPORTS');
  });

  it('resolves CONTRADICTS for a mismatched claim signal', () => {
    expect(resolveSignalOutcome(event({ value: { matched: false } }))).toBe('CONTRADICTS');
  });

  it('resolves NEUTRAL for an unregistered signal name', () => {
    expect(
      resolveSignalOutcome(event({ signalName: 'not_a_real_signal', value: { matched: true } })),
    ).toBe('NEUTRAL');
  });

  it('resolves NEUTRAL for a bundle with no registered entries (e.g. visual, not built until M9)', () => {
    expect(
      resolveSignalOutcome(event({ bundle: 'visual', signalName: 'anything', value: {} })),
    ).toBe('NEUTRAL');
  });

  describe('presence signals', () => {
    it('resolves SUPPORTS when available', () => {
      expect(
        resolveSignalOutcome(
          event({
            signalName: 'reference_photo_available',
            value: { available: true, reference: null },
          }),
        ),
      ).toBe('SUPPORTS');
    });

    it('resolves NEUTRAL, not CONTRADICTS, when unavailable', () => {
      expect(
        resolveSignalOutcome(
          event({
            signalName: 'reference_photo_available',
            value: { available: false, reference: null },
          }),
        ),
      ).toBe('NEUTRAL');
    });
  });

  describe('consistency signals', () => {
    it('resolves SUPPORTS when consistent', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'metadata',
            signalName: 'ip_geolocation_consistency',
            value: { consistent: true, observedValue: 'US', statedValue: 'US' },
          }),
        ),
      ).toBe('SUPPORTS');
    });

    it('resolves CONTRADICTS when inconsistent', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'metadata',
            signalName: 'ip_geolocation_consistency',
            value: { consistent: false, observedValue: 'US', statedValue: 'IN' },
          }),
        ),
      ).toBe('CONTRADICTS');
    });

    it('resolves NEUTRAL when there is nothing to compare (consistent: null)', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'metadata',
            signalName: 'ip_geolocation_consistency',
            value: { consistent: null, observedValue: 'US', statedValue: null },
          }),
        ),
      ).toBe('NEUTRAL');
    });
  });

  describe('detection signals', () => {
    it('resolves CONTRADICTS when a virtual capture device is detected', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'metadata',
            signalName: 'virtual_capture_device_detected',
            value: { detected: true },
          }),
        ),
      ).toBe('CONTRADICTS');
    });

    it('resolves NEUTRAL when not detected', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'metadata',
            signalName: 'virtual_capture_device_detected',
            value: { detected: false },
          }),
        ),
      ).toBe('NEUTRAL');
    });
  });

  describe('join_method', () => {
    it('resolves SUPPORTS for a direct invite link', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'metadata',
            signalName: 'join_method',
            value: { method: 'direct_invite_link', joinOrder: 1 },
          }),
        ),
      ).toBe('SUPPORTS');
    });

    it('resolves CONTRADICTS for a forwarded link', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'metadata',
            signalName: 'join_method',
            value: { method: 'forwarded_link', joinOrder: 1 },
          }),
        ),
      ).toBe('CONTRADICTS');
    });

    it('resolves NEUTRAL for an unknown method', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'metadata',
            signalName: 'join_method',
            value: { method: 'unknown', joinOrder: null },
          }),
        ),
      ).toBe('NEUTRAL');
    });
  });

  it('resolves NEUTRAL for screen_share_state (deliberately unregistered, ADR-16)', () => {
    expect(
      resolveSignalOutcome(
        event({
          bundle: 'metadata',
          signalName: 'screen_share_state',
          value: { state: 'sharing_screen' },
        }),
      ),
    ).toBe('NEUTRAL');
  });

  describe('embedding self-consistency signals (visual/audio, M9)', () => {
    it('resolves SUPPORTS for face_embedding_self_consistency above threshold', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'visual',
            signalName: 'face_embedding_self_consistency',
            value: { similarity: 0.9, isFirstObservation: false },
          }),
        ),
      ).toBe('SUPPORTS');
    });

    it('resolves CONTRADICTS for face_embedding_self_consistency below threshold', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'visual',
            signalName: 'face_embedding_self_consistency',
            value: { similarity: 0.2, isFirstObservation: false },
          }),
        ),
      ).toBe('CONTRADICTS');
    });

    it('resolves NEUTRAL for the first observation (similarity: null)', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'visual',
            signalName: 'face_embedding_self_consistency',
            value: { similarity: null, isFirstObservation: true },
          }),
        ),
      ).toBe('NEUTRAL');
    });

    it('resolves SUPPORTS for voice_embedding_self_consistency above threshold', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'audio',
            signalName: 'voice_embedding_self_consistency',
            value: { similarity: 0.85, isFirstObservation: false },
          }),
        ),
      ).toBe('SUPPORTS');
    });
  });

  describe('visual_liveness', () => {
    it('resolves SUPPORTS when live', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'visual',
            signalName: 'visual_liveness',
            value: { score: 0.9, isLive: true },
          }),
        ),
      ).toBe('SUPPORTS');
    });

    it('resolves CONTRADICTS when not live', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'visual',
            signalName: 'visual_liveness',
            value: { score: 0.1, isLive: false },
          }),
        ),
      ).toBe('CONTRADICTS');
    });
  });

  describe('device signals (M10, ADR-16 near-zero weight)', () => {
    it('resolves CONTRADICTS for a high tab_focus_change count', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'device',
            signalName: 'tab_focus_change',
            value: { count: 10, windowMs: 60_000 },
          }),
        ),
      ).toBe('CONTRADICTS');
    });

    it('resolves NEUTRAL for a low tab_focus_change count', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'device',
            signalName: 'tab_focus_change',
            value: { count: 1, windowMs: 60_000 },
          }),
        ),
      ).toBe('NEUTRAL');
    });

    it('resolves CONTRADICTS for any clipboard_paste at all', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'device',
            signalName: 'clipboard_paste',
            value: { count: 1, windowMs: 60_000 },
          }),
        ),
      ).toBe('CONTRADICTS');
    });

    it('resolves NEUTRAL for zero clipboard pastes', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'device',
            signalName: 'clipboard_paste',
            value: { count: 0, windowMs: 60_000 },
          }),
        ),
      ).toBe('NEUTRAL');
    });

    it('registers every device signal at a magnitude an order of magnitude smaller than the weakest claim/metadata signal', () => {
      const deviceContradiction = Math.abs(
        signalLogLikelihoodRatio(
          event({
            bundle: 'device',
            signalName: 'clipboard_paste',
            value: { count: 5, windowMs: 60_000 },
          }),
        ),
      );
      const weakestClaimContradiction = Math.abs(
        signalLogLikelihoodRatio(
          event({ bundle: 'claim', signalName: 'display_name_match', value: { matched: false } }),
        ),
      );
      expect(deviceContradiction).toBeLessThan(weakestClaimContradiction);
    });
  });

  describe('linguistic signals (M11)', () => {
    it('resolves SUPPORTS for a consistent biographical claim', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'linguistic',
            signalName: 'biographical_claim_consistency',
            value: { consistent: true, claimTopic: 'employer' },
          }),
        ),
      ).toBe('SUPPORTS');
    });

    it('resolves CONTRADICTS for an inconsistent biographical claim', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'linguistic',
            signalName: 'biographical_claim_consistency',
            value: { consistent: false, claimTopic: 'employer' },
          }),
        ),
      ).toBe('CONTRADICTS');
    });

    it('resolves NEUTRAL when there is nothing to compare (consistent: null)', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'linguistic',
            signalName: 'biographical_claim_consistency',
            value: { consistent: null, claimTopic: 'employer' },
          }),
        ),
      ).toBe('NEUTRAL');
    });
  });

  describe('elicitation signals (M11)', () => {
    it('resolves SUPPORTS when the challenge was satisfied', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'elicitation',
            signalName: 'active_elicitation_response',
            value: { challengeType: 'repeat_phrase', satisfied: true },
          }),
        ),
      ).toBe('SUPPORTS');
    });

    it('resolves CONTRADICTS when the challenge was not satisfied', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'elicitation',
            signalName: 'active_elicitation_response',
            value: { challengeType: 'repeat_phrase', satisfied: false },
          }),
        ),
      ).toBe('CONTRADICTS');
    });

    it('resolves NEUTRAL when no response was captured', () => {
      expect(
        resolveSignalOutcome(
          event({
            bundle: 'elicitation',
            signalName: 'active_elicitation_response',
            value: { challengeType: 'repeat_phrase', satisfied: null },
          }),
        ),
      ).toBe('NEUTRAL');
    });

    it('registers active_elicitation_response as one of the strongest signals in the registry', () => {
      const elicitationSupport = signalLogLikelihoodRatio(
        event({
          bundle: 'elicitation',
          signalName: 'active_elicitation_response',
          value: { challengeType: 'repeat_phrase', satisfied: true },
        }),
      );
      const claimSupport = signalLogLikelihoodRatio(
        event({ bundle: 'claim', signalName: 'email_domain_match', value: { matched: true } }),
      );
      expect(elicitationSupport).toBeGreaterThan(claimSupport);
    });
  });

  it('resolves NEUTRAL for change-point signals (deliberately unregistered -- causal path is ContradictionSignal, not the log-odds sum)', () => {
    expect(
      resolveSignalOutcome(
        event({
          bundle: 'visual',
          signalName: 'face_embedding_change_point',
          value: { detected: true, cumulativeDeviation: 0.5 },
        }),
      ),
    ).toBe('NEUTRAL');
  });
});

describe('signalLogLikelihoodRatio', () => {
  it('is positive for a supporting signal', () => {
    expect(signalLogLikelihoodRatio(event({ value: { matched: true } }))).toBeGreaterThan(0);
  });

  it('is negative for a contradicting signal', () => {
    expect(signalLogLikelihoodRatio(event({ value: { matched: false } }))).toBeLessThan(0);
  });

  it('is exactly 0 for a NO_SIGNAL_DETECTED event', () => {
    expect(
      signalLogLikelihoodRatio(
        event({ healthStatus: 'NO_SIGNAL_DETECTED', value: { matched: false } }),
      ),
    ).toBe(0);
  });

  it('is exactly 0 for an unregistered signal', () => {
    expect(signalLogLikelihoodRatio(event({ signalName: 'not_a_real_signal' }))).toBe(0);
  });

  it('is symmetric in magnitude for display_name_match (a low-reliability signal by design)', () => {
    const supports = signalLogLikelihoodRatio(event({ value: { matched: true } }));
    const contradicts = signalLogLikelihoodRatio(event({ value: { matched: false } }));
    expect(supports).toBeCloseTo(-contradicts, 10);
  });
});
