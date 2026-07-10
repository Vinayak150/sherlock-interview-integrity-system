import { ConsistentHashRing } from './consistentHashRing.js';
import type { SessionRegistry } from './sessionRegistry.js';

/**
 * The Session Registry & Router (RFC §9.4, ADR-8; Plan §3 component
 * breakdown): "consistent-hash routing of session events to the owning
 * Orchestrator replica; rebalancing on replica churn."
 *
 * `resolveOwner` prefers the registry's recorded owner when that owner is
 * still a known-healthy replica (stability: a session does not bounce
 * between replicas just because the ring was recomputed) and only falls
 * back to a fresh hash-ring computation when there is no recorded owner,
 * or the recorded owner has left the known replica set (RFC §9.4:
 * "rebalance ... as replicas come and go"). Detecting *when* a replica has
 * left the set is a deployment-platform concern (health checks, service
 * discovery) this module deliberately does not implement — `updateReplicaSet`
 * is the seam a caller uses to report a new known-good set.
 */
export class SessionRouter {
  private ring: ConsistentHashRing;

  constructor(
    replicaIds: readonly string[],
    private readonly registry: SessionRegistry,
    private readonly virtualNodesPerReplica?: number,
  ) {
    this.ring = new ConsistentHashRing(replicaIds, virtualNodesPerReplica);
  }

  get replicaIds(): readonly string[] {
    return this.ring.replicaIds;
  }

  /** Replaces the known replica set (e.g. after a scale-out/scale-in event reported by the deployment platform), rebuilding the ring. Already-registered ownership for sessions is left untouched in the registry -- `resolveOwner`'s own staleness check reassigns lazily, on next access, rather than eagerly rebalancing every session at once. */
  updateReplicaSet(replicaIds: readonly string[]): void {
    this.ring = new ConsistentHashRing(replicaIds, this.virtualNodesPerReplica);
  }

  /**
   * Resolves (and persists, if newly assigned or rebalanced) the owning
   * replica for `sessionId`. Registry unavailability (RFC §9.4) degrades
   * to a fresh hash-ring computation rather than failing the caller --
   * "stale routing, not data loss" -- since the registry is never the
   * source of truth for session content.
   */
  async resolveOwner(sessionId: string): Promise<string> {
    let existingOwner: string | null = null;
    try {
      existingOwner = await this.registry.getOwner(sessionId);
    } catch {
      existingOwner = null; // Degrade to a fresh ring computation; see RFC §9.4.
    }

    if (existingOwner !== null && this.ring.replicaIds.includes(existingOwner)) {
      return existingOwner;
    }

    const computedOwner = this.ring.ownerOf(sessionId);
    try {
      await this.registry.setOwner(sessionId, computedOwner);
    } catch {
      // Registry write failed -- the computed owner is still correct for this call; a later
      // call will simply recompute the same way until the registry becomes reachable again.
    }
    return computedOwner;
  }

  async isOwnedBy(sessionId: string, replicaId: string): Promise<boolean> {
    const owner = await this.resolveOwner(sessionId);
    return owner === replicaId;
  }
}
