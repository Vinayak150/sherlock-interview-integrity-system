import type { FusionPosterior } from '../fusion/index.js';
import type { SessionSnapshotRepository } from '../persistence/index.js';
import type {
  ContradictionSignal,
  LifecycleSessionRecord,
  LifecycleState,
  LifecycleStateManager,
  LifecycleTransitionResult,
} from '../statemachine/index.js';
import {
  deserializeLifecycleSessionRecord,
  serializeLifecycleSessionRecord,
} from './lifecycleSnapshotCodec.js';

export interface SessionLifecycleStoreOptions {
  /** Whether to write a new durable snapshot whenever a lifecycle transition actually occurs. Default `true` — RFC §9.3's "periodic checkpoints," bounded here to state *changes* rather than every tick, keeping write volume low (RFC §9.0's sizing envelope) while still capturing every transition promptly. */
  readonly snapshotOnTransition?: boolean;
}

/**
 * The recovery-aware wrapper around `LifecycleStateManager` (M4) that Plan
 * M7 calls for: "snapshot-based recovery path exercised on replica
 * restart." Composes the Lifecycle FSM (M4) with the Evidence Store's
 * session-state-snapshots table (M1) so that the *first* time this
 * replica evaluates a given session, it recovers the last durable
 * snapshot instead of silently starting over at `UNKNOWN` — RFC §9.2's
 * "reload the last snapshot for affected sessions ... and resume; a few
 * seconds of evidence between last snapshot and crash is an acceptable,
 * bounded loss."
 *
 * This class owns no lifecycle-transition *logic* of its own — every
 * decision about what state comes next is still `LifecycleStateManager`'s
 * (M4); this module only adds persistence around it, preserving "Keep
 * orchestration independent of business logic."
 */
export class SessionLifecycleStore {
  private readonly recoveredSessions = new Set<string>();
  private readonly nextSequenceBySession = new Map<string, number>();
  private readonly snapshotOnTransition: boolean;

  constructor(
    private readonly lifecycleManager: LifecycleStateManager,
    private readonly snapshotRepository: SessionSnapshotRepository,
    options: SessionLifecycleStoreOptions = {},
  ) {
    this.snapshotOnTransition = options.snapshotOnTransition ?? true;
  }

  /** Current state without triggering a recovery attempt -- a pure, synchronous read of whatever this replica already holds in memory (matching `LifecycleStateManager.getState`'s own contract). */
  getState(sessionId: string): LifecycleState {
    return this.lifecycleManager.getState(sessionId);
  }

  async evaluate(
    sessionId: string,
    posterior: FusionPosterior,
    now: Date = new Date(),
    contradiction?: ContradictionSignal,
  ): Promise<LifecycleTransitionResult> {
    await this.ensureRecovered(sessionId);

    const result = this.lifecycleManager.evaluate(sessionId, posterior, now, contradiction);

    if (this.snapshotOnTransition && result.transitioned) {
      await this.persistSnapshot(sessionId, result.record);
    }

    return result;
  }

  /**
   * The recovery-aware passthrough to `LifecycleStateManager.applyHumanOverride`
   * (ADR-3; Plan M13's `HumanOverrideAction` round-trip) — ensures this
   * session's state has been recovered on this replica first (the same
   * guarantee `evaluate` provides), then durably snapshots the override
   * itself, since a human override is exactly the kind of state change
   * RFC §9.3's periodic checkpoints exist to capture.
   */
  async applyHumanOverride(
    sessionId: string,
    nextState: LifecycleState,
    now: Date = new Date(),
    reason?: string,
  ): Promise<LifecycleTransitionResult> {
    await this.ensureRecovered(sessionId);

    const result =
      reason === undefined
        ? this.lifecycleManager.applyHumanOverride(sessionId, nextState, now)
        : this.lifecycleManager.applyHumanOverride(sessionId, nextState, now, reason);

    if (this.snapshotOnTransition) {
      await this.persistSnapshot(sessionId, result.record);
    }

    return result;
  }

  /** Passthrough to `LifecycleStateManager.getAllStates` — see that method's own doc comment for scope (this replica's in-memory sessions only). */
  getAllStates(): ReadonlyMap<string, LifecycleState> {
    return this.lifecycleManager.getAllStates();
  }

  /**
   * Loads and restores the last durable snapshot for `sessionId`, exactly
   * once per session per `SessionLifecycleStore` instance (i.e. once per
   * replica-lifetime for that session, mirroring the RFC's "a replica
   * that loses its sessions on crash ... loads the last snapshot and
   * resumes" -- recovery happens on first touch, not on every call).
   */
  private async ensureRecovered(sessionId: string): Promise<void> {
    if (this.recoveredSessions.has(sessionId)) return;

    const snapshot = await this.snapshotRepository.getLatest(sessionId);
    if (snapshot !== null) {
      const record = deserializeLifecycleSessionRecord(snapshot.state);
      this.lifecycleManager.restoreRecord(sessionId, record);
      this.nextSequenceBySession.set(sessionId, snapshot.sequence + 1);
    } else {
      this.nextSequenceBySession.set(sessionId, 0);
    }
    this.recoveredSessions.add(sessionId);
  }

  private async persistSnapshot(sessionId: string, record: LifecycleSessionRecord): Promise<void> {
    const sequence = this.nextSequenceBySession.get(sessionId) ?? 0;
    await this.snapshotRepository.save({
      sessionId,
      sequence,
      state: serializeLifecycleSessionRecord(record),
    });
    this.nextSequenceBySession.set(sessionId, sequence + 1);
  }
}
