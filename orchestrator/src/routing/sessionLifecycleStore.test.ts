import { describe, expect, it } from 'vitest';

import type { FusionPosterior } from '../fusion/index.js';
import { InMemorySessionSnapshotRepository } from '../persistence/index.js';
import { LifecycleStateManager } from '../statemachine/index.js';
import { SessionLifecycleStore } from './sessionLifecycleStore.js';

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

describe('SessionLifecycleStore', () => {
  it('starts an unseen session at UNKNOWN, same as the underlying LifecycleStateManager', async () => {
    const store = new SessionLifecycleStore(
      new LifecycleStateManager(),
      new InMemorySessionSnapshotRepository(),
    );
    expect(store.getState('session-1')).toBe('UNKNOWN');
  });

  it('evaluates and transitions exactly like the underlying LifecycleStateManager would', async () => {
    const store = new SessionLifecycleStore(
      new LifecycleStateManager(),
      new InMemorySessionSnapshotRepository(),
    );

    const result = await store.evaluate('session-1', evidence(0.55, 1, 1), T0);

    expect(result.record.state).toBe('POSSIBLE_CANDIDATE');
    expect(store.getState('session-1')).toBe('POSSIBLE_CANDIDATE');
  });

  it('writes a durable snapshot on a transition', async () => {
    const snapshotRepository = new InMemorySessionSnapshotRepository();
    const store = new SessionLifecycleStore(new LifecycleStateManager(), snapshotRepository);

    await store.evaluate('session-1', evidence(0.55, 1, 1), T0);

    const latest = await snapshotRepository.getLatest('session-1');
    expect(latest).not.toBeNull();
    expect(latest?.state).toMatchObject({ state: 'POSSIBLE_CANDIDATE' });
    expect(latest?.sequence).toBe(0);
  });

  it('does not write a new snapshot on a tick that holds without transitioning', async () => {
    const snapshotRepository = new InMemorySessionSnapshotRepository();
    const store = new SessionLifecycleStore(new LifecycleStateManager(), snapshotRepository);

    await store.evaluate('session-1', evidence(0.55, 1, 1), T0);
    await store.evaluate('session-1', evidence(0.55, 1, 1), at(1)); // holds at POSSIBLE_CANDIDATE

    const latest = await snapshotRepository.getLatest('session-1');
    expect(latest?.sequence).toBe(0); // still only the first snapshot
  });

  it('increments the snapshot sequence across multiple transitions for the same session', async () => {
    const snapshotRepository = new InMemorySessionSnapshotRepository();
    const store = new SessionLifecycleStore(new LifecycleStateManager(), snapshotRepository);

    await store.evaluate('session-1', evidence(0.55, 1, 1), T0); // -> POSSIBLE_CANDIDATE (sequence 0)
    await store.evaluate('session-1', evidence(0.9, 2, 6), at(1)); // -> climbs further (sequence 1)

    const latest = await snapshotRepository.getLatest('session-1');
    expect(latest?.sequence).toBe(1);
  });

  it('never persists a snapshot when snapshotOnTransition is disabled', async () => {
    const snapshotRepository = new InMemorySessionSnapshotRepository();
    const store = new SessionLifecycleStore(new LifecycleStateManager(), snapshotRepository, {
      snapshotOnTransition: false,
    });

    await store.evaluate('session-1', evidence(0.55, 1, 1), T0);

    await expect(snapshotRepository.getLatest('session-1')).resolves.toBeNull();
  });

  it('recovers a session from its last durable snapshot on first touch by a fresh instance (replica-restart simulation)', async () => {
    const sharedSnapshotRepository = new InMemorySessionSnapshotRepository();

    const replicaA = new SessionLifecycleStore(
      new LifecycleStateManager(),
      sharedSnapshotRepository,
    );
    await replicaA.evaluate('session-1', evidence(0.55, 1, 1), T0); // -> POSSIBLE_CANDIDATE
    await replicaA.evaluate('session-1', evidence(0.9, 2, 6), at(1)); // -> climbs further

    const stateBeforeRestart = replicaA.getState('session-1');
    expect(stateBeforeRestart).not.toBe('UNKNOWN');

    // A brand-new LifecycleStateManager + SessionLifecycleStore, sharing only the persisted
    // snapshot repository -- simulating a replica crash-and-restart, or this session being
    // routed to a different replica that has never seen it before.
    const replicaB = new SessionLifecycleStore(
      new LifecycleStateManager(),
      sharedSnapshotRepository,
    );

    // Before any evaluate() call, replicaB's own local manager still starts at UNKNOWN --
    // recovery is triggered lazily, on first touch, not eagerly.
    expect(replicaB.getState('session-1')).toBe('UNKNOWN');

    // A tick with evidence that merely sustains (rather than weakens or further climbs past)
    // the recovered tier still triggers recovery internally before evaluating -- using the
    // same evidence that reached this tier, well before HIGHLY_CONFIDENT's dwell time has
    // elapsed, so this call holds rather than climbing or regressing on its own.
    await replicaB.evaluate('session-1', evidence(0.9, 2, 6), at(2));

    expect(replicaB.getState('session-1')).toBe(stateBeforeRestart);
  });

  it('continues the snapshot sequence correctly after recovering on a new instance', async () => {
    const sharedSnapshotRepository = new InMemorySessionSnapshotRepository();

    const replicaA = new SessionLifecycleStore(
      new LifecycleStateManager(),
      sharedSnapshotRepository,
    );
    await replicaA.evaluate('session-1', evidence(0.55, 1, 1), T0); // sequence 0

    const replicaB = new SessionLifecycleStore(
      new LifecycleStateManager(),
      sharedSnapshotRepository,
    );
    await replicaB.evaluate('session-1', evidence(0.9, 2, 6), at(1)); // recovers, then transitions -> sequence 1

    const latest = await sharedSnapshotRepository.getLatest('session-1');
    expect(latest?.sequence).toBe(1);
  });

  it('starts a genuinely new session at UNKNOWN even when other sessions have snapshots', async () => {
    const snapshotRepository = new InMemorySessionSnapshotRepository();
    const store = new SessionLifecycleStore(new LifecycleStateManager(), snapshotRepository);

    await store.evaluate('session-with-history', evidence(0.55, 1, 1), T0);

    const freshStore = new SessionLifecycleStore(new LifecycleStateManager(), snapshotRepository);
    await freshStore.evaluate('session-brand-new', posterior({ probability: 0.5 }), T0);

    expect(freshStore.getState('session-brand-new')).toBe('UNKNOWN');
  });

  it('applyHumanOverride moves a session directly to the requested state and durably snapshots it', async () => {
    const snapshotRepository = new InMemorySessionSnapshotRepository();
    const store = new SessionLifecycleStore(new LifecycleStateManager(), snapshotRepository);

    const result = await store.applyHumanOverride(
      'session-1',
      'LOST_CONFIDENCE',
      T0,
      'reviewer cleared it',
    );

    expect(result.record.state).toBe('LOST_CONFIDENCE');
    expect(store.getState('session-1')).toBe('LOST_CONFIDENCE');
    const latest = await snapshotRepository.getLatest('session-1');
    expect(latest?.state).toMatchObject({ state: 'LOST_CONFIDENCE' });
  });

  it('applyHumanOverride recovers the session first if it has not yet been touched on this replica', async () => {
    const sharedSnapshotRepository = new InMemorySessionSnapshotRepository();
    const replicaA = new SessionLifecycleStore(
      new LifecycleStateManager(),
      sharedSnapshotRepository,
    );
    await replicaA.evaluate('session-1', evidence(0.55, 1, 1), T0);

    const replicaB = new SessionLifecycleStore(
      new LifecycleStateManager(),
      sharedSnapshotRepository,
    );
    // replicaB has never evaluated this session -- applyHumanOverride must still recover its
    // prior history (and, more importantly, its snapshot sequence numbering) before overriding.
    await replicaB.applyHumanOverride('session-1', 'DISQUALIFIED', at(1));

    expect(replicaB.getState('session-1')).toBe('DISQUALIFIED');
  });

  it('getAllStates reflects every session evaluated through this store', async () => {
    const store = new SessionLifecycleStore(
      new LifecycleStateManager(),
      new InMemorySessionSnapshotRepository(),
    );
    await store.evaluate('session-a', evidence(0.55, 1, 1), T0);
    await store.evaluate('session-b', posterior({ probability: 0.1 }), T0);

    const states = store.getAllStates();
    expect(states.get('session-a')).toBe('POSSIBLE_CANDIDATE');
    expect(states.get('session-b')).toBe('UNKNOWN');
  });

  it('recovers correctly even when a DISQUALIFIED-then-overridden session is restored', async () => {
    const snapshotRepository = new InMemorySessionSnapshotRepository();
    const manager = new LifecycleStateManager();
    const store = new SessionLifecycleStore(manager, snapshotRepository);

    await store.evaluate('session-1', posterior({ probability: 0.5 }), T0, {
      detectedAt: T0,
      reason: 'test contradiction',
      corroborated: true,
    });
    expect(store.getState('session-1')).toBe('DISQUALIFIED');

    const replicaB = new SessionLifecycleStore(new LifecycleStateManager(), snapshotRepository);
    await replicaB.evaluate('session-1', posterior({ probability: 0.5 }), at(1));

    expect(replicaB.getState('session-1')).toBe('DISQUALIFIED');
  });
});
