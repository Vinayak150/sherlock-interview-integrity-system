import type { FusionPosterior } from '../fusion/index.js';
import { describe, expect, it } from 'vitest';

import {
  LifecycleStateManager,
  evaluateLifecycleTransition,
  initialLifecycleRecord,
} from './lifecycle.js';
import type { LifecycleSessionRecord } from './lifecycle.js';

const T0 = new Date('2026-07-10T12:00:00.000Z');

function at(msFromT0: number): Date {
  return new Date(T0.getTime() + msFromT0);
}

function posterior(overrides: Partial<FusionPosterior> = {}): FusionPosterior {
  return {
    sessionId: 'session-1',
    evaluatedAt: T0,
    logOdds: 0,
    probability: 0.5,
    beta: { alpha: 1, beta: 1 },
    credibleInterval: { lower: 0.05, upper: 0.95, mass: 0.9 },
    bundleContributions: [],
    eligibleEventCount: 0,
    ...overrides,
  };
}

/** A posterior with `bundleCount` distinct contributing bundles and `eligibleEventCount` events, at the given `probability`. */
function evidence(
  probability: number,
  bundleCount: number,
  eligibleEventCount: number,
): FusionPosterior {
  return posterior({
    probability,
    eligibleEventCount,
    bundleContributions: Array.from({ length: bundleCount }, (_, i) => ({
      bundle: (['claim', 'metadata', 'visual', 'audio'] as const)[i] ?? 'claim',
      logOddsContribution: 0.1,
      eligibleEventCount: Math.ceil(eligibleEventCount / bundleCount),
    })),
  });
}

describe('evaluateLifecycleTransition', () => {
  describe('UNKNOWN', () => {
    it('stays UNKNOWN with no evidence', () => {
      const record = initialLifecycleRecord(T0);
      const result = evaluateLifecycleTransition(record, posterior(), T0);
      expect(result).toMatchObject({ transitioned: false });
      expect(result.record.state).toBe('UNKNOWN');
    });

    it('stays UNKNOWN below the POSSIBLE_CANDIDATE enter threshold', () => {
      const record = initialLifecycleRecord(T0);
      const result = evaluateLifecycleTransition(record, evidence(0.54, 1, 1), T0);
      expect(result.record.state).toBe('UNKNOWN');
    });

    it('transitions to POSSIBLE_CANDIDATE on a single bundle of weak claim-match evidence', () => {
      const record = initialLifecycleRecord(T0);
      const result = evaluateLifecycleTransition(record, evidence(0.55, 1, 1), T0);
      expect(result).toMatchObject({ transitioned: true });
      expect(result.record.state).toBe('POSSIBLE_CANDIDATE');
    });

    it('can jump multiple tiers directly to CONFIRMED given overwhelming evidence in one evaluation', () => {
      const record = initialLifecycleRecord(T0);
      const result = evaluateLifecycleTransition(record, evidence(0.96, 3, 10), T0);
      expect(result.record.state).toBe('CONFIRMED');
    });

    it('moves straight to DISQUALIFIED from UNKNOWN given a corroborated contradiction signal', () => {
      const record = initialLifecycleRecord(T0);
      const result = evaluateLifecycleTransition(record, posterior(), T0, {
        detectedAt: T0,
        reason: 'test contradiction',
        corroborated: true,
      });
      expect(result.record.state).toBe('DISQUALIFIED');
    });

    it('routes an uncorroborated change-point to LOST_CONFIDENCE instead of DISQUALIFIED', () => {
      const record = initialLifecycleRecord(T0);
      const result = evaluateLifecycleTransition(record, posterior(), T0, {
        detectedAt: T0,
        reason: 'single-bundle change-point',
        corroborated: false,
      });
      expect(result.record.state).toBe('LOST_CONFIDENCE');
    });
  });

  describe('climbing the ladder', () => {
    it('does not climb past LIKELY_CANDIDATE before its dwell time has elapsed, even if HIGHLY_CONFIDENT criteria are met', () => {
      const atLikely: LifecycleSessionRecord = {
        state: 'LIKELY_CANDIDATE',
        stateEnteredAt: T0,
        recoveryAnnotations: [],
        disqualificationAnnotations: [],
      };
      const result = evaluateLifecycleTransition(atLikely, evidence(0.9, 2, 6), at(30_000));
      expect(result).toMatchObject({ transitioned: false });
      expect(result.record.state).toBe('LIKELY_CANDIDATE');
    });

    it('climbs to HIGHLY_CONFIDENT once LIKELY_CANDIDATE dwell time has elapsed and criteria are met', () => {
      const atLikely: LifecycleSessionRecord = {
        state: 'LIKELY_CANDIDATE',
        stateEnteredAt: T0,
        recoveryAnnotations: [],
        disqualificationAnnotations: [],
      };
      const result = evaluateLifecycleTransition(atLikely, evidence(0.9, 2, 6), at(60_000));
      expect(result).toMatchObject({ transitioned: true });
      expect(result.record.state).toBe('HIGHLY_CONFIDENT');
    });

    it('holds at the current tier when dwell has elapsed but no higher tier criteria are met', () => {
      const atLikely: LifecycleSessionRecord = {
        state: 'LIKELY_CANDIDATE',
        stateEnteredAt: T0,
        recoveryAnnotations: [],
        disqualificationAnnotations: [],
      };
      const result = evaluateLifecycleTransition(atLikely, evidence(0.71, 2, 3), at(60_000));
      expect(result).toMatchObject({ transitioned: false });
      expect(result.record.state).toBe('LIKELY_CANDIDATE');
    });

    it('requires multi-bundle evidence to reach LIKELY_CANDIDATE, even with a high single-bundle probability', () => {
      const atPossible: LifecycleSessionRecord = {
        state: 'POSSIBLE_CANDIDATE',
        stateEnteredAt: T0,
        recoveryAnnotations: [],
        disqualificationAnnotations: [],
      };
      const result = evaluateLifecycleTransition(atPossible, evidence(0.9, 1, 5), at(1));
      expect(result.record.state).toBe('POSSIBLE_CANDIDATE');
    });
  });

  describe('LOST_CONFIDENCE (evidence weakened or went quiet)', () => {
    it('is reached from a climbing tier when probability falls below the sustain threshold', () => {
      const atLikely: LifecycleSessionRecord = {
        state: 'LIKELY_CANDIDATE',
        stateEnteredAt: T0,
        recoveryAnnotations: [],
        disqualificationAnnotations: [],
      };
      const result = evaluateLifecycleTransition(atLikely, evidence(0.55, 2, 3), at(1));
      expect(result.record.state).toBe('LOST_CONFIDENCE');
    });

    it('is not reached merely by dipping between the sustain and enter thresholds of the current tier', () => {
      const atLikely: LifecycleSessionRecord = {
        state: 'LIKELY_CANDIDATE',
        stateEnteredAt: T0,
        recoveryAnnotations: [],
        disqualificationAnnotations: [],
      };
      // 0.65 is above LIKELY_CANDIDATE's sustain (0.6) but below its enter (0.7).
      const result = evaluateLifecycleTransition(atLikely, evidence(0.65, 2, 3), at(1));
      expect(result.record.state).toBe('LIKELY_CANDIDATE');
    });

    it('holds at LOST_CONFIDENCE while evidence has not yet rebuilt', () => {
      const atLost: LifecycleSessionRecord = {
        state: 'LOST_CONFIDENCE',
        stateEnteredAt: T0,
        recoveryAnnotations: [],
        disqualificationAnnotations: [],
      };
      const result = evaluateLifecycleTransition(atLost, evidence(0.3, 1, 1), at(1));
      expect(result).toMatchObject({ transitioned: false });
      expect(result.record.state).toBe('LOST_CONFIDENCE');
    });

    it('transitions to RECOVERED once evidence rebuilds past the POSSIBLE_CANDIDATE bar, with a permanent annotation', () => {
      const atLost: LifecycleSessionRecord = {
        state: 'LOST_CONFIDENCE',
        stateEnteredAt: T0,
        recoveryAnnotations: [],
        disqualificationAnnotations: [],
      };
      const result = evaluateLifecycleTransition(atLost, evidence(0.6, 1, 1), at(1));

      expect(result.record.state).toBe('RECOVERED');
      expect(result.record.recoveryAnnotations).toHaveLength(1);
      expect(result.record.recoveryAnnotations[0]).toMatchObject({
        regressedFromState: 'LOST_CONFIDENCE',
      });
    });
  });

  describe('RECOVERED', () => {
    it('does not silently relabel itself back to POSSIBLE_CANDIDATE on the next evaluation with unchanged evidence', () => {
      const atRecovered: LifecycleSessionRecord = {
        state: 'RECOVERED',
        stateEnteredAt: T0,
        recoveryAnnotations: [{ recoveredAt: T0, regressedFromState: 'LOST_CONFIDENCE' }],
        disqualificationAnnotations: [],
      };
      const result = evaluateLifecycleTransition(atRecovered, evidence(0.6, 1, 1), at(1));

      expect(result.record.state).toBe('RECOVERED');
      expect(result.record.recoveryAnnotations).toHaveLength(1);
    });

    it('can still climb further given genuinely stronger multi-bundle evidence', () => {
      const atRecovered: LifecycleSessionRecord = {
        state: 'RECOVERED',
        stateEnteredAt: T0,
        recoveryAnnotations: [{ recoveredAt: T0, regressedFromState: 'LOST_CONFIDENCE' }],
        disqualificationAnnotations: [],
      };
      const result = evaluateLifecycleTransition(atRecovered, evidence(0.9, 2, 6), at(1));

      expect(result.record.state).toBe('HIGHLY_CONFIDENT');
      expect(result.record.recoveryAnnotations).toHaveLength(1);
    });

    it('preserves the annotation even after climbing well past RECOVERED', () => {
      const atHighlyConfidentAfterRecovery: LifecycleSessionRecord = {
        state: 'CONFIRMED',
        stateEnteredAt: T0,
        recoveryAnnotations: [{ recoveredAt: T0, regressedFromState: 'LOST_CONFIDENCE' }],
        disqualificationAnnotations: [],
      };
      const result = evaluateLifecycleTransition(
        atHighlyConfidentAfterRecovery,
        evidence(0.99, 3, 10),
        at(400_000),
      );

      expect(result.record.recoveryAnnotations).toHaveLength(1);
    });

    it('can regress to LOST_CONFIDENCE again and accumulate a second annotation on a later recovery', () => {
      const atRecovered: LifecycleSessionRecord = {
        state: 'RECOVERED',
        stateEnteredAt: T0,
        recoveryAnnotations: [{ recoveredAt: T0, regressedFromState: 'LOST_CONFIDENCE' }],
        disqualificationAnnotations: [],
      };
      const regressed = evaluateLifecycleTransition(atRecovered, evidence(0.3, 1, 1), at(1));
      expect(regressed.record.state).toBe('LOST_CONFIDENCE');

      const recoveredAgain = evaluateLifecycleTransition(
        regressed.record,
        evidence(0.6, 1, 1),
        at(2),
      );
      expect(recoveredAgain.record.state).toBe('RECOVERED');
      expect(recoveredAgain.record.recoveryAnnotations).toHaveLength(2);
    });
  });

  describe('DISQUALIFIED (ADR-3: mandatory human review, never automatic exit)', () => {
    it('is reached directly from CONFIRMED given a contradiction signal', () => {
      const atConfirmed: LifecycleSessionRecord = {
        state: 'CONFIRMED',
        stateEnteredAt: T0,
        recoveryAnnotations: [],
        disqualificationAnnotations: [],
      };
      const result = evaluateLifecycleTransition(atConfirmed, evidence(0.99, 3, 10), at(1), {
        detectedAt: at(1),
        reason: 'face-embedding change-point',
        bundle: 'visual',
        corroborated: true,
      });
      expect(result.record.state).toBe('DISQUALIFIED');
    });

    it('never transitions automatically out of DISQUALIFIED, regardless of subsequent evidence', () => {
      const atDisqualified: LifecycleSessionRecord = {
        state: 'DISQUALIFIED',
        stateEnteredAt: T0,
        recoveryAnnotations: [],
        disqualificationAnnotations: [],
      };
      const result = evaluateLifecycleTransition(
        atDisqualified,
        evidence(0.99, 3, 10),
        at(1_000_000),
      );
      expect(result).toMatchObject({ transitioned: false });
      expect(result.record.state).toBe('DISQUALIFIED');
    });

    it('never transitions automatically out of DISQUALIFIED even given a fresh contradiction signal', () => {
      const atDisqualified: LifecycleSessionRecord = {
        state: 'DISQUALIFIED',
        stateEnteredAt: T0,
        recoveryAnnotations: [],
        disqualificationAnnotations: [],
      };
      const result = evaluateLifecycleTransition(atDisqualified, posterior(), at(1), {
        detectedAt: at(1),
        reason: 'another contradiction',
        corroborated: true,
      });
      expect(result.record.state).toBe('DISQUALIFIED');
    });
  });
});

describe('LifecycleStateManager', () => {
  it('starts every unseen session at UNKNOWN', () => {
    const manager = new LifecycleStateManager();
    expect(manager.getState('never-seen')).toBe('UNKNOWN');
  });

  it('evaluates and remembers a session transition', () => {
    const manager = new LifecycleStateManager();
    const result = manager.evaluate('session-1', evidence(0.55, 1, 1), T0);

    expect(result.record.state).toBe('POSSIBLE_CANDIDATE');
    expect(manager.getState('session-1')).toBe('POSSIBLE_CANDIDATE');
  });

  it('keeps sessions fully isolated from one another', () => {
    const manager = new LifecycleStateManager();
    manager.evaluate('session-a', evidence(0.55, 1, 1), T0);

    expect(manager.getState('session-a')).toBe('POSSIBLE_CANDIDATE');
    expect(manager.getState('session-b')).toBe('UNKNOWN');
  });

  it('only a human override moves a session out of DISQUALIFIED, and normal evaluation resumes after', () => {
    const manager = new LifecycleStateManager();
    manager.evaluate('session-1', posterior(), T0, {
      detectedAt: T0,
      reason: 'contradiction',
      corroborated: true,
    });
    expect(manager.getState('session-1')).toBe('DISQUALIFIED');

    manager.evaluate('session-1', evidence(0.99, 3, 10), at(1_000));
    expect(manager.getState('session-1')).toBe('DISQUALIFIED');

    const overridden = manager.applyHumanOverride(
      'session-1',
      'LOST_CONFIDENCE',
      at(2_000),
      'reviewer cleared the flag',
    );
    expect(overridden.record.state).toBe('LOST_CONFIDENCE');
    expect(manager.getState('session-1')).toBe('LOST_CONFIDENCE');

    const afterOverride = manager.evaluate('session-1', evidence(0.6, 1, 1), at(3_000));
    expect(afterOverride.record.state).toBe('RECOVERED');
  });

  it('getAllStates reflects every session this manager currently knows about', () => {
    const manager = new LifecycleStateManager();
    manager.evaluate('session-a', evidence(0.55, 1, 1), T0);
    manager.evaluate('session-b', posterior({ probability: 0.1 }), T0);

    const states = manager.getAllStates();
    expect(states.get('session-a')).toBe('POSSIBLE_CANDIDATE');
    expect(states.get('session-b')).toBe('UNKNOWN');
    expect(states.size).toBe(2);
  });

  it('getAllStates is empty for a manager with no evaluated sessions', () => {
    const manager = new LifecycleStateManager();
    expect(manager.getAllStates().size).toBe(0);
  });

  it('restoreRecord primes a session directly (M7 recovery seam), without running the FSM rules', () => {
    const manager = new LifecycleStateManager();
    const restored: LifecycleSessionRecord = {
      state: 'HIGHLY_CONFIDENT',
      stateEnteredAt: T0,
      recoveryAnnotations: [{ recoveredAt: T0, regressedFromState: 'LOST_CONFIDENCE' }],
      disqualificationAnnotations: [],
    };

    manager.restoreRecord('session-1', restored);

    expect(manager.getState('session-1')).toBe('HIGHLY_CONFIDENT');
    expect(manager.getRecord('session-1').recoveryAnnotations).toHaveLength(1);
  });
});
