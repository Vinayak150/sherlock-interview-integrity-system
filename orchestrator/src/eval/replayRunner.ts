import type { EvidenceEvent } from '@sherlock/contracts';

import type { FusionEngine, FusionPosterior } from '../fusion/index.js';
import type { LifecycleStateManager, LifecycleTransitionResult } from '../statemachine/index.js';

/**
 * The offline replay runner (Plan M15: "stand up offline replay ... as a
 * first-class" tool). Reconstructs a session's *entire* historical
 * trajectory — posterior and lifecycle state after every single
 * persisted event — purely from an already-persisted `EvidenceEvent[]`
 * (RFC §9.3's durable ledger), with no dependency on the Evidence Store,
 * HTTP layer, or any other runtime infrastructure. This is the tool a
 * later investigation ("why did this session end up DISQUALIFIED?")
 * or the ablation/calibration tooling in this same module runs against.
 *
 * Deliberately uses fresh `FusionEngine`/`LifecycleStateManager`
 * instances passed in by the caller rather than touching any live
 * session state — replay must never mutate a real session's current
 * in-memory record.
 */
export interface ReplayStep {
  readonly eventIndex: number;
  readonly event: EvidenceEvent;
  readonly posterior: FusionPosterior;
  readonly transition: LifecycleTransitionResult;
}

export interface ReplayResult {
  readonly sessionId: string;
  readonly steps: readonly ReplayStep[];
}

export class ReplayRunner {
  constructor(
    private readonly fusionEngine: FusionEngine,
    private readonly lifecycleManager: LifecycleStateManager,
  ) {}

  /**
   * Replays `events` (assumed sorted ascending by `occurredAt`; callers
   * are responsible for sorting their own query results) one at a time:
   * after each event, recomputes the posterior over every event so far
   * and re-evaluates the Lifecycle FSM, exactly as if that event had just
   * arrived live.
   */
  replay(sessionId: string, events: readonly EvidenceEvent[]): ReplayResult {
    const steps: ReplayStep[] = [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i] as EvidenceEvent;
      const eventsSoFar = events.slice(0, i + 1);
      const posterior = this.fusionEngine.computePosterior(
        sessionId,
        eventsSoFar,
        event.occurredAt,
      );
      const transition = this.lifecycleManager.evaluate(sessionId, posterior, event.occurredAt);
      steps.push({ eventIndex: i, event, posterior, transition });
    }

    return { sessionId, steps };
  }
}
