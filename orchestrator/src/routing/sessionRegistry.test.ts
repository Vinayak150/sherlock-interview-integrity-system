import { describe, expect, it, vi } from 'vitest';

import { SessionRegistryError } from './errors.js';
import type { RedisClientPort } from './redisClient.js';
import {
  DEFAULT_OWNER_TTL_SECONDS,
  InMemorySessionRegistry,
  RedisSessionRegistry,
} from './sessionRegistry.js';

function fakeRedisClient(): {
  client: RedisClientPort;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn();
  const set = vi.fn();
  const del = vi.fn();
  return { client: { get, set, del, quit: vi.fn() }, get, set, del };
}

describe('RedisSessionRegistry', () => {
  describe('getOwner', () => {
    it('returns the value stored under the session-owner key', async () => {
      const { client, get } = fakeRedisClient();
      get.mockResolvedValueOnce('replica-a');
      const registry = new RedisSessionRegistry(client);

      await expect(registry.getOwner('session-1')).resolves.toBe('replica-a');
      expect(get).toHaveBeenCalledWith('sherlock:session-owner:session-1');
    });

    it('returns null when no owner is recorded', async () => {
      const { client, get } = fakeRedisClient();
      get.mockResolvedValueOnce(null);
      const registry = new RedisSessionRegistry(client);

      await expect(registry.getOwner('session-1')).resolves.toBeNull();
    });

    it('wraps a client failure in SessionRegistryError', async () => {
      const { client, get } = fakeRedisClient();
      get.mockRejectedValueOnce(new Error('connection refused'));
      const registry = new RedisSessionRegistry(client);

      await expect(registry.getOwner('session-1')).rejects.toBeInstanceOf(SessionRegistryError);
    });

    it('rejects an empty sessionId without calling the client', async () => {
      const { client, get } = fakeRedisClient();
      const registry = new RedisSessionRegistry(client);

      await expect(registry.getOwner('')).rejects.toBeInstanceOf(SessionRegistryError);
      expect(get).not.toHaveBeenCalled();
    });
  });

  describe('setOwner', () => {
    it('writes the owner with the default TTL', async () => {
      const { client, set } = fakeRedisClient();
      const registry = new RedisSessionRegistry(client);

      await registry.setOwner('session-1', 'replica-a');

      expect(set).toHaveBeenCalledWith(
        'sherlock:session-owner:session-1',
        'replica-a',
        DEFAULT_OWNER_TTL_SECONDS,
      );
    });

    it('honors a custom TTL', async () => {
      const { client, set } = fakeRedisClient();
      const registry = new RedisSessionRegistry(client, { ttlSeconds: 60 });

      await registry.setOwner('session-1', 'replica-a');

      expect(set).toHaveBeenCalledWith('sherlock:session-owner:session-1', 'replica-a', 60);
    });

    it('wraps a client failure in SessionRegistryError', async () => {
      const { client, set } = fakeRedisClient();
      set.mockRejectedValueOnce(new Error('timeout'));
      const registry = new RedisSessionRegistry(client);

      await expect(registry.setOwner('session-1', 'replica-a')).rejects.toBeInstanceOf(
        SessionRegistryError,
      );
    });
  });

  describe('releaseOwner', () => {
    it('deletes the entry when replicaId matches the current owner', async () => {
      const { client, get, del } = fakeRedisClient();
      get.mockResolvedValueOnce('replica-a');
      const registry = new RedisSessionRegistry(client);

      await registry.releaseOwner('session-1', 'replica-a');

      expect(del).toHaveBeenCalledWith('sherlock:session-owner:session-1');
    });

    it('does not delete the entry when replicaId does not match the current owner (compare-and-release)', async () => {
      const { client, get, del } = fakeRedisClient();
      get.mockResolvedValueOnce('replica-b');
      const registry = new RedisSessionRegistry(client);

      await registry.releaseOwner('session-1', 'replica-a');

      expect(del).not.toHaveBeenCalled();
    });

    it('does not delete when there is no current owner at all', async () => {
      const { client, get, del } = fakeRedisClient();
      get.mockResolvedValueOnce(null);
      const registry = new RedisSessionRegistry(client);

      await registry.releaseOwner('session-1', 'replica-a');

      expect(del).not.toHaveBeenCalled();
    });
  });
});

describe('InMemorySessionRegistry', () => {
  it('returns null for an unknown session', async () => {
    const registry = new InMemorySessionRegistry();
    await expect(registry.getOwner('session-1')).resolves.toBeNull();
  });

  it('returns the set owner', async () => {
    const registry = new InMemorySessionRegistry();
    await registry.setOwner('session-1', 'replica-a');
    await expect(registry.getOwner('session-1')).resolves.toBe('replica-a');
  });

  it('overwrites a prior owner on a later setOwner call', async () => {
    const registry = new InMemorySessionRegistry();
    await registry.setOwner('session-1', 'replica-a');
    await registry.setOwner('session-1', 'replica-b');
    await expect(registry.getOwner('session-1')).resolves.toBe('replica-b');
  });

  it('releaseOwner only clears the entry when replicaId matches the current owner', async () => {
    const registry = new InMemorySessionRegistry();
    await registry.setOwner('session-1', 'replica-a');

    await registry.releaseOwner('session-1', 'replica-b');
    await expect(registry.getOwner('session-1')).resolves.toBe('replica-a');

    await registry.releaseOwner('session-1', 'replica-a');
    await expect(registry.getOwner('session-1')).resolves.toBeNull();
  });

  it('keeps ownership isolated per session', async () => {
    const registry = new InMemorySessionRegistry();
    await registry.setOwner('session-a', 'replica-1');
    await registry.setOwner('session-b', 'replica-2');

    await expect(registry.getOwner('session-a')).resolves.toBe('replica-1');
    await expect(registry.getOwner('session-b')).resolves.toBe('replica-2');
  });

  it('rejects an empty sessionId or replicaId', async () => {
    const registry = new InMemorySessionRegistry();
    await expect(registry.getOwner('')).rejects.toBeInstanceOf(SessionRegistryError);
    await expect(registry.setOwner('session-1', '')).rejects.toBeInstanceOf(SessionRegistryError);
  });
});
