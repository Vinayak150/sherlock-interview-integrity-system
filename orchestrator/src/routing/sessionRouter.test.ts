import { describe, expect, it } from 'vitest';

import { InMemorySessionRegistry } from './sessionRegistry.js';
import type { SessionRegistry } from './sessionRegistry.js';
import { SessionRouter } from './sessionRouter.js';

describe('SessionRouter', () => {
  it('assigns and persists an owner for a previously unseen session', async () => {
    const registry = new InMemorySessionRegistry();
    const router = new SessionRouter(['replica-a', 'replica-b'], registry);

    const owner = await router.resolveOwner('session-1');

    expect(['replica-a', 'replica-b']).toContain(owner);
    await expect(registry.getOwner('session-1')).resolves.toBe(owner);
  });

  it('is stable: a session already recorded in the registry keeps its owner on later calls', async () => {
    const registry = new InMemorySessionRegistry();
    await registry.setOwner('session-1', 'replica-b');
    const router = new SessionRouter(['replica-a', 'replica-b'], registry);

    await expect(router.resolveOwner('session-1')).resolves.toBe('replica-b');
  });

  it('reassigns via the ring when the recorded owner has left the known replica set', async () => {
    const registry = new InMemorySessionRegistry();
    await registry.setOwner('session-1', 'replica-gone');
    const router = new SessionRouter(['replica-a', 'replica-b'], registry);

    const owner = await router.resolveOwner('session-1');

    expect(['replica-a', 'replica-b']).toContain(owner);
    await expect(registry.getOwner('session-1')).resolves.toBe(owner);
  });

  it('degrades to a fresh ring computation when the registry read fails (stale routing, not data loss)', async () => {
    const failingRegistry: SessionRegistry = {
      getOwner: async () => {
        throw new Error('registry unavailable');
      },
      setOwner: async () => undefined,
      releaseOwner: async () => undefined,
    };
    const router = new SessionRouter(['replica-a', 'replica-b'], failingRegistry);

    const owner = await router.resolveOwner('session-1');
    expect(['replica-a', 'replica-b']).toContain(owner);
  });

  it('still returns a computed owner even when the registry write fails', async () => {
    const writeFailingRegistry: SessionRegistry = {
      getOwner: async () => null,
      setOwner: async () => {
        throw new Error('registry unavailable');
      },
      releaseOwner: async () => undefined,
    };
    const router = new SessionRouter(['replica-a', 'replica-b'], writeFailingRegistry);

    const owner = await router.resolveOwner('session-1');
    expect(['replica-a', 'replica-b']).toContain(owner);
  });

  it('isOwnedBy reflects the resolved owner', async () => {
    const registry = new InMemorySessionRegistry();
    const router = new SessionRouter(['replica-a'], registry);

    await expect(router.isOwnedBy('session-1', 'replica-a')).resolves.toBe(true);
    await expect(router.isOwnedBy('session-1', 'replica-b')).resolves.toBe(false);
  });

  it('updateReplicaSet rebuilds the ring and is reflected in replicaIds', async () => {
    const registry = new InMemorySessionRegistry();
    const router = new SessionRouter(['replica-a'], registry);

    router.updateReplicaSet(['replica-a', 'replica-b', 'replica-c']);

    expect(router.replicaIds).toEqual(['replica-a', 'replica-b', 'replica-c']);
  });

  it('rebalances a session whose recorded owner was removed by updateReplicaSet', async () => {
    const registry = new InMemorySessionRegistry();
    const router = new SessionRouter(['replica-a', 'replica-b'], registry);

    const originalOwner = await router.resolveOwner('session-1');
    const survivingReplicas = ['replica-a', 'replica-b'].filter((id) => id !== originalOwner);
    router.updateReplicaSet(survivingReplicas);

    const newOwner = await router.resolveOwner('session-1');
    expect(survivingReplicas).toContain(newOwner);
  });
});
