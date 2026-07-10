/**
 * Public surface of the routing module (RFC §9.4, ADR-8; Plan §9
 * repository structure `orchestrator/routing/`, Milestone M7).
 */
export { ConsistentHashRing } from './consistentHashRing.js';

export { SessionRegistryError } from './errors.js';

export type { RedisClientPort } from './redisClient.js';
export { createRedisClient } from './redisClient.js';

export type { SessionRegistry } from './sessionRegistry.js';
export {
  DEFAULT_OWNER_TTL_SECONDS,
  InMemorySessionRegistry,
  RedisSessionRegistry,
} from './sessionRegistry.js';

export { SessionRouter } from './sessionRouter.js';

export {
  LifecycleSnapshotCodecError,
  deserializeLifecycleSessionRecord,
  serializeLifecycleSessionRecord,
} from './lifecycleSnapshotCodec.js';

export type { SessionLifecycleStoreOptions } from './sessionLifecycleStore.js';
export { SessionLifecycleStore } from './sessionLifecycleStore.js';
