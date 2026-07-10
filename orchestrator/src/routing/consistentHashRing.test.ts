import { describe, expect, it } from 'vitest';

import { ConsistentHashRing } from './consistentHashRing.js';

describe('ConsistentHashRing', () => {
  it('rejects an empty replica set', () => {
    expect(() => new ConsistentHashRing([])).toThrow(RangeError);
  });

  it('rejects a non-positive virtualNodesPerReplica', () => {
    expect(() => new ConsistentHashRing(['a'], 0)).toThrow(RangeError);
  });

  it('always resolves to one of the known replicas', () => {
    const ring = new ConsistentHashRing(['replica-a', 'replica-b', 'replica-c']);
    for (let i = 0; i < 200; i++) {
      expect(ring.replicaIds).toContain(ring.ownerOf(`session-${i}`));
    }
  });

  it('is deterministic: the same key always resolves to the same replica', () => {
    const ring = new ConsistentHashRing(['replica-a', 'replica-b', 'replica-c']);
    const first = ring.ownerOf('session-42');
    for (let i = 0; i < 10; i++) {
      expect(ring.ownerOf('session-42')).toBe(first);
    }
  });

  it('is deterministic across separate ring instances with the same replica set', () => {
    const ringA = new ConsistentHashRing(['replica-a', 'replica-b']);
    const ringB = new ConsistentHashRing(['replica-a', 'replica-b']);
    expect(ringA.ownerOf('session-x')).toBe(ringB.ownerOf('session-x'));
  });

  it('trivially resolves every key to the sole replica in a single-replica ring', () => {
    const ring = new ConsistentHashRing(['only-replica']);
    for (let i = 0; i < 20; i++) {
      expect(ring.ownerOf(`session-${i}`)).toBe('only-replica');
    }
  });

  it('distributes a large key population reasonably evenly across replicas', () => {
    const replicaIds = ['replica-a', 'replica-b', 'replica-c', 'replica-d'];
    const ring = new ConsistentHashRing(replicaIds);
    const counts = new Map(replicaIds.map((id) => [id, 0]));

    const sampleSize = 4_000;
    for (let i = 0; i < sampleSize; i++) {
      const owner = ring.ownerOf(`session-${i}`);
      counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }

    const expectedShare = sampleSize / replicaIds.length;
    for (const count of counts.values()) {
      // Generous tolerance (+/- 30%) -- this is a distribution-quality smoke test, not a
      // statistical claim about the hash function.
      expect(count).toBeGreaterThan(expectedShare * 0.7);
      expect(count).toBeLessThan(expectedShare * 1.3);
    }
  });

  it('remaps only a small fraction of keys when a replica is added (the core consistent-hashing property)', () => {
    const before = new ConsistentHashRing(['replica-a', 'replica-b', 'replica-c']);
    const after = new ConsistentHashRing(['replica-a', 'replica-b', 'replica-c', 'replica-d']);

    const sampleSize = 2_000;
    let remapped = 0;
    for (let i = 0; i < sampleSize; i++) {
      const key = `session-${i}`;
      if (before.ownerOf(key) !== after.ownerOf(key)) remapped++;
    }

    // With 4 replicas taking over from 3, roughly 1/4 of keys should move -- nowhere near a
    // full remap, which is exactly the property that makes consistent hashing worth using
    // over naive `hash(key) % replicaCount`.
    expect(remapped / sampleSize).toBeLessThan(0.4);
  });

  it('exposes the configured replica set via replicaIds', () => {
    const ring = new ConsistentHashRing(['replica-a', 'replica-b']);
    expect(ring.replicaIds).toEqual(['replica-a', 'replica-b']);
  });
});
