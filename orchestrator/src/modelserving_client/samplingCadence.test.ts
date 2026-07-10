import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BASELINE_INTERVAL_MS,
  DEFAULT_BORDERLINE_INTERVAL_MS,
  DEFAULT_STABLE_INTERVAL_MS,
  computeSamplingCadence,
} from './samplingCadence.js';

describe('computeSamplingCadence', () => {
  it('samples at the stable (least frequent) interval when CONFIRMED with a tight interval', () => {
    const decision = computeSamplingCadence({
      lifecycleState: 'CONFIRMED',
      probability: 0.97,
      credibleIntervalWidth: 0.05,
    });
    expect(decision.intervalMs).toBe(DEFAULT_STABLE_INTERVAL_MS);
  });

  it('samples at the stable interval when HIGHLY_CONFIDENT with a tight interval', () => {
    const decision = computeSamplingCadence({
      lifecycleState: 'HIGHLY_CONFIDENT',
      probability: 0.88,
      credibleIntervalWidth: 0.1,
    });
    expect(decision.intervalMs).toBe(DEFAULT_STABLE_INTERVAL_MS);
  });

  it('samples at the borderline (most frequent) interval while LOST_CONFIDENCE', () => {
    const decision = computeSamplingCadence({
      lifecycleState: 'LOST_CONFIDENCE',
      probability: 0.4,
      credibleIntervalWidth: 0.2,
    });
    expect(decision.intervalMs).toBe(DEFAULT_BORDERLINE_INTERVAL_MS);
  });

  it('samples at the borderline interval while DISQUALIFIED (needs close attention despite being "resolved")', () => {
    const decision = computeSamplingCadence({
      lifecycleState: 'DISQUALIFIED',
      probability: 0.1,
      credibleIntervalWidth: 0.1,
    });
    expect(decision.intervalMs).toBe(DEFAULT_BORDERLINE_INTERVAL_MS);
  });

  it('samples at the borderline interval whenever the credible interval is wide, regardless of state', () => {
    const decision = computeSamplingCadence({
      lifecycleState: 'CONFIRMED',
      probability: 0.6,
      credibleIntervalWidth: 0.5,
    });
    expect(decision.intervalMs).toBe(DEFAULT_BORDERLINE_INTERVAL_MS);
  });

  it('prioritizes instability over a nominally stable state (widening interval overrides CONFIRMED)', () => {
    const decision = computeSamplingCadence({
      lifecycleState: 'CONFIRMED',
      probability: 0.9,
      credibleIntervalWidth: 0.45,
    });
    expect(decision.intervalMs).toBe(DEFAULT_BORDERLINE_INTERVAL_MS);
  });

  it('falls back to the baseline interval for ordinary, unremarkable operation', () => {
    const decision = computeSamplingCadence({
      lifecycleState: 'LIKELY_CANDIDATE',
      probability: 0.75,
      credibleIntervalWidth: 0.25,
    });
    expect(decision.intervalMs).toBe(DEFAULT_BASELINE_INTERVAL_MS);
  });

  it('falls back to baseline for POSSIBLE_CANDIDATE even with a moderately tight interval (not yet in a stable state)', () => {
    const decision = computeSamplingCadence({
      lifecycleState: 'POSSIBLE_CANDIDATE',
      probability: 0.6,
      credibleIntervalWidth: 0.1,
    });
    expect(decision.intervalMs).toBe(DEFAULT_BASELINE_INTERVAL_MS);
  });

  it('honors custom interval/threshold options', () => {
    const decision = computeSamplingCadence(
      { lifecycleState: 'CONFIRMED', probability: 0.99, credibleIntervalWidth: 0.02 },
      { stableIntervalMs: 60_000, stableMaxIntervalWidth: 0.03 },
    );
    expect(decision.intervalMs).toBe(60_000);
  });

  it('rejects a negative interval option', () => {
    expect(() =>
      computeSamplingCadence(
        { lifecycleState: 'UNKNOWN', probability: 0.5, credibleIntervalWidth: 0.9 },
        { borderlineIntervalMs: -1 },
      ),
    ).toThrow(RangeError);
  });

  it('always returns a non-empty reason string', () => {
    const decision = computeSamplingCadence({
      lifecycleState: 'UNKNOWN',
      probability: 0.5,
      credibleIntervalWidth: 0.9,
    });
    expect(decision.reason.length).toBeGreaterThan(0);
  });
});
