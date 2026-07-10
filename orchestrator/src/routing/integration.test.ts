import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import type { RedisClientPort } from './redisClient.js';
import { createRedisClient } from './redisClient.js';
import { RedisSessionRegistry } from './sessionRegistry.js';
import { SessionRouter } from './sessionRouter.js';

/**
 * Opt-in end-to-end coverage against a real Redis instance (RFC §9.4).
 *
 * The rest of this module's tests use fakes/an in-memory double
 * deliberately — they run everywhere, fast, with no external dependency.
 * This suite exists because a fake `RedisClientPort` cannot, by
 * construction, prove the real `ioredis` client and TTL semantics behave
 * as assumed. Skipped unless `RUN_REDIS_INTEGRATION_TESTS=true` and a
 * reachable Redis is configured (see `docker-compose.yml`'s `redis`
 * service), mirroring `persistence/integration.test.ts`'s pattern exactly.
 */
const RUN_INTEGRATION_TESTS = process.env.RUN_REDIS_INTEGRATION_TESTS === 'true';

describe.skipIf(!RUN_INTEGRATION_TESTS)('Session Registry -- Redis integration (opt-in)', () => {
  let client: RedisClientPort;

  beforeAll(() => {
    client = createRedisClient(loadConfig().redis.url);
  });

  afterAll(async () => {
    await client?.quit();
  });

  it('persists and retrieves an owner end-to-end', async () => {
    const registry = new RedisSessionRegistry(client);
    const sessionId = `itest-owner-${Date.now()}`;

    await registry.setOwner(sessionId, 'replica-a');
    await expect(registry.getOwner(sessionId)).resolves.toBe('replica-a');

    await registry.releaseOwner(sessionId, 'replica-a');
    await expect(registry.getOwner(sessionId)).resolves.toBeNull();
  });

  it('honors compare-and-release against a real Redis instance', async () => {
    const registry = new RedisSessionRegistry(client);
    const sessionId = `itest-release-${Date.now()}`;

    await registry.setOwner(sessionId, 'replica-a');
    await registry.releaseOwner(sessionId, 'replica-b'); // wrong replica -- must not clear it

    await expect(registry.getOwner(sessionId)).resolves.toBe('replica-a');
  });

  it('sets a TTL on the owner entry so it does not live forever', async () => {
    const registry = new RedisSessionRegistry(client, { ttlSeconds: 1 });
    const sessionId = `itest-ttl-${Date.now()}`;

    await registry.setOwner(sessionId, 'replica-a');
    await expect(registry.getOwner(sessionId)).resolves.toBe('replica-a');

    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await expect(registry.getOwner(sessionId)).resolves.toBeNull();
  });

  it('resolves session ownership end-to-end through SessionRouter against real Redis', async () => {
    const registry = new RedisSessionRegistry(client);
    const router = new SessionRouter(['replica-a', 'replica-b'], registry);
    const sessionId = `itest-router-${Date.now()}`;

    const first = await router.resolveOwner(sessionId);
    const second = await router.resolveOwner(sessionId);

    expect(first).toBe(second);
    expect(['replica-a', 'replica-b']).toContain(first);
  });
});
