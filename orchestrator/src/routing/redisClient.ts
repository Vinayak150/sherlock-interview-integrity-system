import { Redis } from 'ioredis';

/**
 * The narrow Redis operations `SessionRegistry` needs (RFC §9.4's "small,
 * low-write-volume key-value store"). Mirrors `persistence/db.ts`'s
 * `QueryExecutor` dependency-inversion shape: `RedisSessionRegistry`
 * depends on this port, never on `ioredis` directly, so it stays testable
 * against a fake and swappable if the store technology ever changes.
 */
export interface RedisClientPort {
  get(key: string): Promise<string | null>;
  /** `ttlSeconds`, if given, sets an expiry so an abandoned session's registry entry does not live forever. */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  quit(): Promise<void>;
}

function toRedisClientPort(client: Redis): RedisClientPort {
  return {
    async get(key: string): Promise<string | null> {
      return client.get(key);
    },
    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
      if (ttlSeconds === undefined) {
        await client.set(key, value);
      } else {
        await client.set(key, value, 'EX', ttlSeconds);
      }
    },
    async del(key: string): Promise<void> {
      await client.del(key);
    },
    async quit(): Promise<void> {
      await client.quit();
    },
  };
}

/**
 * Builds the Session Registry's Redis connection (RFC §9.4). Kept as a
 * thin, mockable wrapper around `ioredis` — the same shape as
 * `persistence/db.ts`'s `createDbPool` for the Evidence Store.
 */
export function createRedisClient(url: string): RedisClientPort {
  const client = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
  return toRedisClientPort(client);
}
