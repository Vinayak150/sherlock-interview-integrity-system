import type { EvidenceEvent } from '@sherlock/contracts';
import { describe, expect, it } from 'vitest';

import { DEFAULT_HALF_LIFE_MS } from './decay.js';
import { FusionEngine } from './fusionEngine.js';

const EVALUATED_AT = new Date('2026-07-10T12:30:00.000Z');
let nextId = 0;

function event(overrides: Partial<EvidenceEvent> = {}): EvidenceEvent {
  nextId += 1;
  return {
    id: `00000000-0000-0000-0000-${String(nextId).padStart(12, '0')}`,
    sessionId: 'session-1',
    bundle: 'claim',
    signalName: 'email_domain_match',
    healthStatus: 'OK',
    value: { matched: true, observedValue: 'a@x.com', claimedValue: 'a@x.com' },
    occurredAt: EVALUATED_AT,
    recordedAt: EVALUATED_AT,
    metadata: null,
    ...overrides,
  };
}

describe('FusionEngine.computePosterior', () => {
  it('returns a 50/50 posterior with a wide credible interval when there is no evidence', () => {
    const engine = new FusionEngine();
    const posterior = engine.computePosterior('session-1', [], EVALUATED_AT);

    expect(posterior.logOdds).toBe(0);
    expect(posterior.probability).toBeCloseTo(0.5, 10);
    expect(posterior.eligibleEventCount).toBe(0);
    expect(posterior.bundleContributions).toHaveLength(0);
    // Beta(1,1): the 90% credible interval is exactly [0.05, 0.95].
    expect(posterior.credibleInterval.lower).toBeCloseTo(0.05, 4);
    expect(posterior.credibleInterval.upper).toBeCloseTo(0.95, 4);
  });

  it('raises the probability above 0.5 given a single supporting claim signal', () => {
    const engine = new FusionEngine();
    const posterior = engine.computePosterior(
      'session-1',
      [event({ value: { matched: true } })],
      EVALUATED_AT,
    );

    expect(posterior.logOdds).toBeGreaterThan(0);
    expect(posterior.probability).toBeGreaterThan(0.5);
    expect(posterior.eligibleEventCount).toBe(1);
  });

  it('lowers the probability below 0.5 given a single contradicting claim signal', () => {
    const engine = new FusionEngine();
    const posterior = engine.computePosterior(
      'session-1',
      [event({ value: { matched: false } })],
      EVALUATED_AT,
    );

    expect(posterior.logOdds).toBeLessThan(0);
    expect(posterior.probability).toBeLessThan(0.5);
  });

  it('excludes SERVICE_UNAVAILABLE events entirely from the sum and from eligibleEventCount', () => {
    const engine = new FusionEngine();
    const withOutage = engine.computePosterior(
      'session-1',
      [event({ healthStatus: 'SERVICE_UNAVAILABLE', value: { reason: 'ATS unavailable' } })],
      EVALUATED_AT,
    );
    const withNothing = engine.computePosterior('session-1', [], EVALUATED_AT);

    expect(withOutage.logOdds).toBe(withNothing.logOdds);
    expect(withOutage.probability).toBe(withNothing.probability);
    expect(withOutage.eligibleEventCount).toBe(0);
    expect(withOutage.bundleContributions).toHaveLength(0);
  });

  it('does not let a NO_SIGNAL_DETECTED event move the posterior even if its value looks like a mismatch', () => {
    const engine = new FusionEngine();
    const posterior = engine.computePosterior(
      'session-1',
      [
        event({
          healthStatus: 'NO_SIGNAL_DETECTED',
          value: { matched: false, observedValue: null, claimedValue: null },
        }),
      ],
      EVALUATED_AT,
    );

    expect(posterior.logOdds).toBe(0);
    expect(posterior.probability).toBeCloseTo(0.5, 10);
    // Still counted as eligible/considered -- just contributes nothing numerically.
    expect(posterior.eligibleEventCount).toBe(1);
  });

  it('groups contributions bundle-locally, keeping claim and metadata subtotals separate', () => {
    const engine = new FusionEngine();
    const posterior = engine.computePosterior(
      'session-1',
      [
        event({ bundle: 'claim', signalName: 'email_domain_match', value: { matched: true } }),
        event({
          bundle: 'metadata',
          signalName: 'ip_geolocation_consistency',
          value: { consistent: true, observedValue: 'US', statedValue: 'US' },
        }),
      ],
      EVALUATED_AT,
    );

    expect(posterior.bundleContributions).toHaveLength(2);
    const byBundle = new Map(posterior.bundleContributions.map((c) => [c.bundle, c]));
    expect(byBundle.get('claim')?.eligibleEventCount).toBe(1);
    expect(byBundle.get('metadata')?.eligibleEventCount).toBe(1);
    expect(byBundle.get('claim')?.logOddsContribution).toBeGreaterThan(0);
    expect(byBundle.get('metadata')?.logOddsContribution).toBeGreaterThan(0);
  });

  it('decays older evidence toward zero contribution relative to fresh evidence', () => {
    const engine = new FusionEngine();
    const freshOnly = engine.computePosterior(
      'session-1',
      [event({ occurredAt: EVALUATED_AT, value: { matched: true } })],
      EVALUATED_AT,
    );
    const staleOnly = engine.computePosterior(
      'session-1',
      [
        event({
          occurredAt: new Date(EVALUATED_AT.getTime() - 3 * DEFAULT_HALF_LIFE_MS),
          value: { matched: true },
        }),
      ],
      EVALUATED_AT,
    );

    expect(staleOnly.logOdds).toBeGreaterThan(0);
    expect(staleOnly.logOdds).toBeLessThan(freshOnly.logOdds);
  });

  it('narrows the credible interval as more corroborating evidence accumulates', () => {
    const engine = new FusionEngine();
    const oneSignal = engine.computePosterior(
      'session-1',
      [event({ value: { matched: true } })],
      EVALUATED_AT,
    );
    const manySignals = engine.computePosterior(
      'session-1',
      [
        event({ signalName: 'email_domain_match', value: { matched: true } }),
        event({ signalName: 'calendar_invite_match', value: { matched: true } }),
        event({
          bundle: 'metadata',
          signalName: 'ip_geolocation_consistency',
          value: { consistent: true, observedValue: 'US', statedValue: 'US' },
        }),
      ],
      EVALUATED_AT,
    );

    const oneWidth = oneSignal.credibleInterval.upper - oneSignal.credibleInterval.lower;
    const manyWidth = manySignals.credibleInterval.upper - manySignals.credibleInterval.lower;
    expect(manyWidth).toBeLessThan(oneWidth);
  });

  it('honors a custom prior log-odds', () => {
    const engine = new FusionEngine({ priorLogOdds: 1 });
    const posterior = engine.computePosterior('session-1', [], EVALUATED_AT);

    expect(posterior.logOdds).toBe(1);
    expect(posterior.probability).toBeGreaterThan(0.5);
  });

  it('honors a custom half-life', () => {
    const shortHalfLife = new FusionEngine({ halfLifeMs: 1_000 });
    const posterior = shortHalfLife.computePosterior(
      'session-1',
      [event({ occurredAt: new Date(EVALUATED_AT.getTime() - 1_000), value: { matched: true } })],
      EVALUATED_AT,
    );

    // Exactly one custom half-life elapsed -> contribution should be half of an undecayed event's.
    const undecayed = shortHalfLife.computePosterior(
      'session-1',
      [event({ occurredAt: EVALUATED_AT, value: { matched: true } })],
      EVALUATED_AT,
    );
    expect(posterior.logOdds).toBeCloseTo(undecayed.logOdds / 2, 6);
  });

  it('rejects a non-positive baselineConcentration', () => {
    expect(() => new FusionEngine({ baselineConcentration: 0 })).toThrow(RangeError);
  });

  it('rejects a non-positive logLrClamp', () => {
    expect(() => new FusionEngine({ logLrClamp: 0 })).toThrow(RangeError);
  });

  describe('per-event log-LR clamp (RFC §13, ADR-12; Plan M14)', () => {
    it('does not alter a legitimately-registered signal magnitude under the default clamp', () => {
      const engine = new FusionEngine();
      const posterior = engine.computePosterior(
        'session-1',
        [
          event({
            bundle: 'visual',
            signalName: 'visual_liveness',
            value: { score: 0.1, isLive: false },
          }),
        ],
        EVALUATED_AT,
      );
      // visual_liveness's contradictsLogLR (-0.5) is comfortably inside the default clamp
      // (0.6) -- unaffected by it in ordinary operation.
      expect(posterior.bundleContributions[0]?.logOddsContribution).toBeCloseTo(-0.5, 6);
    });

    it('bounds a single event contribution to the configured clamp, regardless of its raw magnitude', () => {
      const engine = new FusionEngine({ logLrClamp: 0.1 });
      const posterior = engine.computePosterior(
        'session-1',
        [
          event({
            bundle: 'visual',
            signalName: 'visual_liveness',
            value: { score: 0.1, isLive: false },
          }),
        ],
        EVALUATED_AT,
      );
      // The same -0.5 raw contribution is now clamped to the tighter -0.1 limit.
      expect(posterior.bundleContributions[0]?.logOddsContribution).toBeCloseTo(-0.1, 6);
    });

    it('applies the clamp per event, not to the running total (multiple clamped events still accumulate)', () => {
      const engine = new FusionEngine({ logLrClamp: 0.1 });
      const posterior = engine.computePosterior(
        'session-1',
        [
          event({
            bundle: 'visual',
            signalName: 'visual_liveness',
            value: { score: 0.1, isLive: false },
          }),
          event({
            bundle: 'visual',
            signalName: 'visual_liveness',
            value: { score: 0.1, isLive: false },
          }),
        ],
        EVALUATED_AT,
      );
      expect(posterior.bundleContributions[0]?.logOddsContribution).toBeCloseTo(-0.2, 6);
    });
  });

  it('only considers events matching the requested sessionId', () => {
    const engine = new FusionEngine();
    const posterior = engine.computePosterior(
      'session-1',
      [
        event({ sessionId: 'session-1', value: { matched: true } }),
        event({ sessionId: 'session-2', value: { matched: true } }),
      ],
      EVALUATED_AT,
    );

    expect(posterior.eligibleEventCount).toBe(1);
  });
});
