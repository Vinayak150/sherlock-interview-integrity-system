import type { RedisClientPort } from './redisClient.js';
import { SessionRegistryError } from './errors.js';

/**
 * The Session Registry port (RFC §9.4, ADR-8): "a lightweight session
 * registry (session_id -> owning replica) so a replica restart or
 * scale-out event can rebalance without every client needing to know the
 * hashing scheme directly." `releaseOwner` is intentionally
 * compare-and-release (only clears the entry if `replicaId` is still the
 * recorded owner) so a stale or racing caller can never clear another
 * replica's live ownership out from under it.
 *
 * Registry unavailability degrades to stale routing, never data loss
 * (RFC §9.4: "since the source of truth for session content is the
 * evidence ledger, not the registry") — callers (`SessionRouter`) are
 * expected to treat a `SessionRegistryError` as a signal to fall back to
 * the hash ring, not as a fatal condition.
 */
export interface SessionRegistry {
  getOwner(sessionId: string): Promise<string | null>;
  setOwner(sessionId: string, replicaId: string): Promise<void>;
  releaseOwner(sessionId: string, replicaId: string): Promise<void>;
}

function assertNonEmpty(name: string, value: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SessionRegistryError(`${name} must be a non-empty string`);
  }
}

/** ~4 hours: comfortably longer than RFC §9.0's stated 30-90 minute typical interview length, so a live session's ownership entry never expires mid-call, while an abandoned one does not live forever. */
export const DEFAULT_OWNER_TTL_SECONDS = 4 * 60 * 60;

const REGISTRY_KEY_PREFIX = 'sherlock:session-owner:';

function registryKey(sessionId: string): string {
  return `${REGISTRY_KEY_PREFIX}${sessionId}`;
}

/**
 * Redis-backed `SessionRegistry`. Depends only on the narrow
 * `RedisClientPort` — the fact that RFC §9.4 named Redis-class storage is
 * an implementation detail hidden behind it, matching every other
 * repository in this codebase's dependency-inversion shape.
 */
export class RedisSessionRegistry implements SessionRegistry {
  private readonly ttlSeconds: number;

  constructor(
    private readonly client: RedisClientPort,
    options: { readonly ttlSeconds?: number } = {},
  ) {
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_OWNER_TTL_SECONDS;
  }

  async getOwner(sessionId: string): Promise<string | null> {
    assertNonEmpty('sessionId', sessionId);
    try {
      return await this.client.get(registryKey(sessionId));
    } catch (error) {
      throw new SessionRegistryError(`Failed to read owner for session "${sessionId}"`, error);
    }
  }

  async setOwner(sessionId: string, replicaId: string): Promise<void> {
    assertNonEmpty('sessionId', sessionId);
    assertNonEmpty('replicaId', replicaId);
    try {
      await this.client.set(registryKey(sessionId), replicaId, this.ttlSeconds);
    } catch (error) {
      throw new SessionRegistryError(`Failed to set owner for session "${sessionId}"`, error);
    }
  }

  async releaseOwner(sessionId: string, replicaId: string): Promise<void> {
    assertNonEmpty('sessionId', sessionId);
    assertNonEmpty('replicaId', replicaId);
    try {
      const current = await this.client.get(registryKey(sessionId));
      if (current === replicaId) {
        await this.client.del(registryKey(sessionId));
      }
    } catch (error) {
      throw new SessionRegistryError(`Failed to release owner for session "${sessionId}"`, error);
    }
  }
}

/**
 * An in-memory `SessionRegistry`, sharing the Redis-backed
 * implementation's exact compare-and-release semantics. A first-class
 * test double for `SessionRouter` and any future caller's own tests — not
 * a production storage option, since the registry's whole purpose is to
 * be shared across replicas (RFC §9.4).
 */
export class InMemorySessionRegistry implements SessionRegistry {
  private readonly ownerBySession = new Map<string, string>();

  async getOwner(sessionId: string): Promise<string | null> {
    assertNonEmpty('sessionId', sessionId);
    return this.ownerBySession.get(sessionId) ?? null;
  }

  async setOwner(sessionId: string, replicaId: string): Promise<void> {
    assertNonEmpty('sessionId', sessionId);
    assertNonEmpty('replicaId', replicaId);
    this.ownerBySession.set(sessionId, replicaId);
  }

  async releaseOwner(sessionId: string, replicaId: string): Promise<void> {
    assertNonEmpty('sessionId', sessionId);
    assertNonEmpty('replicaId', replicaId);
    if (this.ownerBySession.get(sessionId) === replicaId) {
      this.ownerBySession.delete(sessionId);
    }
  }
}
