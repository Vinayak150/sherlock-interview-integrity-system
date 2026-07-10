import { createHash } from 'node:crypto';

/**
 * Consistent-hash session routing (RFC §9.4, ADR-8): "the same approach
 * many real-time systems with per-room or per-connection state use ...
 * gives ordered, single-owner delivery per session — the actual property
 * needed — without a durable log or a broker."
 *
 * This is the pure hashing/lookup structure only. It has no notion of a
 * live registry, replica health, or rebalancing policy — those are
 * `SessionRegistry`/`SessionRouter`'s job. Deterministic and side-effect
 * free, so it is trivially unit-testable in isolation, matching every
 * other "core math" module in this codebase (`fusion/beta.ts`,
 * `fusion/decay.ts`).
 */

const DEFAULT_VIRTUAL_NODES_PER_REPLICA = 100;

interface RingNode {
  readonly hash: number;
  readonly replicaId: string;
}

/** A 32-bit unsigned hash derived from SHA-1, truncated to its first 4 bytes -- deterministic, well-distributed, and dependency-free (Node's built-in `crypto`). Not used for anything security-sensitive; only for load distribution. */
function hash32(input: string): number {
  const digest = createHash('sha1').update(input).digest();
  return digest.readUInt32BE(0);
}

function compareNodes(a: RingNode, b: RingNode): number {
  return a.hash - b.hash;
}

export class ConsistentHashRing {
  private readonly ring: readonly RingNode[];
  private readonly knownReplicaIds: readonly string[];

  constructor(
    replicaIds: readonly string[],
    virtualNodesPerReplica: number = DEFAULT_VIRTUAL_NODES_PER_REPLICA,
  ) {
    if (replicaIds.length === 0) {
      throw new RangeError('ConsistentHashRing requires at least one replica');
    }
    if (!(virtualNodesPerReplica > 0)) {
      throw new RangeError(
        `virtualNodesPerReplica must be positive, received ${virtualNodesPerReplica}`,
      );
    }

    const nodes: RingNode[] = [];
    for (const replicaId of replicaIds) {
      for (let vnode = 0; vnode < virtualNodesPerReplica; vnode++) {
        nodes.push({ hash: hash32(`${replicaId}#${vnode}`), replicaId });
      }
    }
    nodes.sort(compareNodes);

    this.ring = nodes;
    this.knownReplicaIds = [...replicaIds];
  }

  get replicaIds(): readonly string[] {
    return this.knownReplicaIds;
  }

  /**
   * The replica that owns `key` on this ring: the first virtual node at or
   * after `key`'s hash position, wrapping around to the first node on the
   * ring if `key` hashes past every node (classic consistent-hashing
   * lookup).
   */
  ownerOf(key: string): string {
    const target = hash32(key);

    let lower = 0;
    let upper = this.ring.length;
    while (lower < upper) {
      const mid = Math.floor((lower + upper) / 2);
      if ((this.ring[mid] as RingNode).hash < target) {
        lower = mid + 1;
      } else {
        upper = mid;
      }
    }

    const node = this.ring[lower % this.ring.length] as RingNode;
    return node.replicaId;
  }
}
