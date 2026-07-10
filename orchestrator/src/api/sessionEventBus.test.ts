import { describe, expect, it, vi } from 'vitest';

import type { Decision } from '../decision/index.js';
import { SessionEventBus } from './sessionEventBus.js';

function decision(sessionId: string): Decision {
  return {
    sessionId,
    decidedAt: new Date(),
    lifecycleState: 'LIKELY_CANDIDATE',
    abstained: false,
    ambiguous: false,
    reviewerRecommendation: 'NONE',
    alert: null,
    elicitationTrigger: null,
    evidenceRef: {
      sessionId,
      capturedAt: new Date(),
      events: [],
      posterior: {
        sessionId,
        evaluatedAt: new Date(),
        logOdds: 0,
        probability: 0.5,
        beta: { alpha: 1, beta: 1 },
        credibleInterval: { lower: 0.05, upper: 0.95, mass: 0.9 },
        bundleContributions: [],
        eligibleEventCount: 0,
      },
    },
  };
}

describe('SessionEventBus', () => {
  it('delivers a published decision to a subscriber of the same session', () => {
    const bus = new SessionEventBus();
    const listener = vi.fn();
    bus.subscribe('session-1', listener);

    const d = decision('session-1');
    bus.publish(d);

    expect(listener).toHaveBeenCalledWith(d);
  });

  it('never delivers a session-1 event to a session-2 subscriber', () => {
    const bus = new SessionEventBus();
    const listener = vi.fn();
    bus.subscribe('session-2', listener);

    bus.publish(decision('session-1'));

    expect(listener).not.toHaveBeenCalled();
  });

  it('supports multiple subscribers for the same session', () => {
    const bus = new SessionEventBus();
    const first = vi.fn();
    const second = vi.fn();
    bus.subscribe('session-1', first);
    bus.subscribe('session-1', second);

    bus.publish(decision('session-1'));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes cleanly via the returned function', () => {
    const bus = new SessionEventBus();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe('session-1', listener);

    unsubscribe();
    bus.publish(decision('session-1'));

    expect(listener).not.toHaveBeenCalled();
  });

  it('delivers no events to a subscriber before anything is published', () => {
    const bus = new SessionEventBus();
    const listener = vi.fn();
    bus.subscribe('session-1', listener);

    expect(listener).not.toHaveBeenCalled();
  });
});
