import { describe, expect, it } from 'vitest';

import {
  ChangePointDetector,
  INITIAL_CHANGE_POINT_STATE,
  observeChangePoint,
} from './changePointDetector.js';

describe('observeChangePoint', () => {
  it('does not flag a change-point when similarity matches the target', () => {
    const result = observeChangePoint(INITIAL_CHANGE_POINT_STATE, 0.9);
    expect(result.changePointDetected).toBe(false);
    expect(result.state.cumulativeDeviation).toBe(0);
  });

  it('does not flag a change-point for a single small dip within the slack allowance', () => {
    const result = observeChangePoint(INITIAL_CHANGE_POINT_STATE, 0.82);
    expect(result.changePointDetected).toBe(false);
  });

  it('accumulates deviation across repeated below-target observations', () => {
    let state = INITIAL_CHANGE_POINT_STATE;
    for (let i = 0; i < 3; i++) {
      const result = observeChangePoint(state, 0.5);
      state = result.state;
    }
    expect(state.cumulativeDeviation).toBeGreaterThan(0);
  });

  it('flags a change-point once cumulative deviation exceeds the control limit', () => {
    let state = INITIAL_CHANGE_POINT_STATE;
    let flagged = false;
    for (let i = 0; i < 20 && !flagged; i++) {
      const result = observeChangePoint(state, 0.1); // a sudden, sustained drop -- a plausible swap
      state = result.state;
      flagged = result.changePointDetected;
    }
    expect(flagged).toBe(true);
  });

  it('resets the accumulator to zero immediately after flagging', () => {
    let state = { cumulativeDeviation: 0.35, sampleCount: 5 }; // already over the default 0.3 limit
    const result = observeChangePoint(state, 0.1);
    expect(result.changePointDetected).toBe(true);
    expect(result.state.cumulativeDeviation).toBe(0);
  });

  it('never lets a single high-similarity observation push cumulativeDeviation negative', () => {
    const result = observeChangePoint(INITIAL_CHANGE_POINT_STATE, 1.0);
    expect(result.state.cumulativeDeviation).toBe(0);
  });

  it('recovers back toward zero once similarity comfortably exceeds target again after a small dip', () => {
    const afterDip = observeChangePoint(INITIAL_CHANGE_POINT_STATE, 0.6);
    expect(afterDip.state.cumulativeDeviation).toBeGreaterThan(0);

    const afterRecovery = observeChangePoint(afterDip.state, 1.0);
    expect(afterRecovery.state.cumulativeDeviation).toBe(0);
    expect(afterRecovery.state.cumulativeDeviation).toBeLessThan(
      afterDip.state.cumulativeDeviation,
    );
  });

  it('increments sampleCount on every observation regardless of outcome', () => {
    const result = observeChangePoint(INITIAL_CHANGE_POINT_STATE, 0.9);
    expect(result.state.sampleCount).toBe(1);
  });

  it('honors custom targetSimilarity/slack/controlLimit options', () => {
    const result = observeChangePoint(INITIAL_CHANGE_POINT_STATE, 0.5, {
      targetSimilarity: 0.5,
      slack: 0.1,
      controlLimit: 0.05,
    });
    expect(result.changePointDetected).toBe(false); // 0.5 - 0.5 - 0.1 clamped to 0 deviation
  });

  it('rejects a similarity outside [-1, 1]', () => {
    expect(() => observeChangePoint(INITIAL_CHANGE_POINT_STATE, 1.5)).toThrow(RangeError);
  });
});

describe('ChangePointDetector', () => {
  it('tracks state independently per (sessionId, bundle) key', () => {
    const detector = new ChangePointDetector();
    // 0.6 is a moderate dip (not yet enough to flag in one step) so accumulation is observable
    // before it resets on a flag.
    detector.observe('session-1', 'visual', 0.6);

    expect(detector.getState('session-1', 'audio')).toEqual(INITIAL_CHANGE_POINT_STATE);
    expect(detector.getState('session-1', 'visual').cumulativeDeviation).toBeGreaterThan(0);
  });

  it('keeps sessions fully isolated', () => {
    const detector = new ChangePointDetector();
    detector.observe('session-a', 'visual', 0.1);

    expect(detector.getState('session-b', 'visual')).toEqual(INITIAL_CHANGE_POINT_STATE);
  });

  it('eventually flags a change-point through repeated observe() calls on the same key', () => {
    const detector = new ChangePointDetector();
    let flagged = false;
    for (let i = 0; i < 20 && !flagged; i++) {
      flagged = detector.observe('session-1', 'visual', 0.1).changePointDetected;
    }
    expect(flagged).toBe(true);
  });
});
