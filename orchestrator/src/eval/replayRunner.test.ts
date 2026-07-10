import type { EvidenceEvent } from '@sherlock/contracts';
import { describe, expect, it } from 'vitest';

import { FusionEngine } from '../fusion/index.js';
import { LifecycleStateManager } from '../statemachine/index.js';
import { ReplayRunner } from './replayRunner.js';

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
    value: { matched: true, observedValue: 'a@x.com', claimedValue: 'a@x.com' },
    occurredAt: T0,
    recordedAt: T0,
    metadata: null,
    ...overrides,
  };
}

describe('ReplayRunner', () => {
  it('produces one step per event, in order', () => {
    const runner = new ReplayRunner(new FusionEngine(), new LifecycleStateManager());
    const events = [
      event({ occurredAt: T0 }),
      event({ occurredAt: new Date(T0.getTime() + 1000) }),
    ];

    const result = runner.replay('session-1', events);

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]?.eventIndex).toBe(0);
    expect(result.steps[1]?.eventIndex).toBe(1);
  });

  it('each step reflects the cumulative posterior over every event so far, not just that one event', () => {
    const runner = new ReplayRunner(new FusionEngine(), new LifecycleStateManager());
    const events = [
      event({ signalName: 'email_domain_match', value: { matched: true }, occurredAt: T0 }),
      event({
        signalName: 'display_name_match',
        value: { matched: true },
        occurredAt: new Date(T0.getTime() + 1000),
      }),
    ];

    const result = runner.replay('session-1', events);

    const firstEligible = result.steps[0]?.posterior.eligibleEventCount;
    const secondEligible = result.steps[1]?.posterior.eligibleEventCount;
    expect(firstEligible).toBe(1);
    expect(secondEligible).toBe(2);
  });

  it('produces a monotonically-consistent lifecycle trajectory matching a live evaluate() sequence', () => {
    const fusionEngine = new FusionEngine();
    const events = [
      event({
        bundle: 'claim',
        signalName: 'email_domain_match',
        value: { matched: true },
        occurredAt: T0,
      }),
      event({
        bundle: 'claim',
        signalName: 'display_name_match',
        value: { matched: true },
        occurredAt: new Date(T0.getTime() + 1000),
      }),
      event({
        bundle: 'metadata',
        signalName: 'calendar_invite_match',
        value: { matched: true },
        occurredAt: new Date(T0.getTime() + 2000),
      }),
    ];

    // Live path: evaluate incrementally through the actual runtime sequence.
    const liveManager = new LifecycleStateManager();
    let liveState;
    for (let i = 0; i < events.length; i++) {
      const posterior = fusionEngine.computePosterior(
        'session-1',
        events.slice(0, i + 1),
        (events[i] as EvidenceEvent).occurredAt,
      );
      liveState = liveManager.evaluate(
        'session-1',
        posterior,
        (events[i] as EvidenceEvent).occurredAt,
      ).record.state;
    }

    // Replay path: same events, through ReplayRunner.
    const runner = new ReplayRunner(new FusionEngine(), new LifecycleStateManager());
    const result = runner.replay('session-1', events);
    const replayedFinalState = result.steps.at(-1)?.transition.record.state;

    expect(replayedFinalState).toBe(liveState);
  });

  it('returns an empty result for a session with no events', () => {
    const runner = new ReplayRunner(new FusionEngine(), new LifecycleStateManager());
    const result = runner.replay('session-1', []);
    expect(result.steps).toHaveLength(0);
  });

  it('never mutates the lifecycle manager for a different session it was not asked to replay', () => {
    const manager = new LifecycleStateManager();
    manager.evaluate('other-session', {
      sessionId: 'other-session',
      evaluatedAt: T0,
      logOdds: 0,
      probability: 0.5,
      beta: { alpha: 1, beta: 1 },
      credibleInterval: { lower: 0.05, upper: 0.95, mass: 0.9 },
      bundleContributions: [],
      eligibleEventCount: 0,
    });

    const runner = new ReplayRunner(new FusionEngine(), manager);
    runner.replay('session-1', [event({ occurredAt: T0 })]);

    expect(manager.getState('other-session')).toBe('UNKNOWN');
  });
});
