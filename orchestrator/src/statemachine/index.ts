/**
 * Public surface of the State Manager module (RFC §6; Plan §9 repository
 * structure `orchestrator/statemachine/`).
 *
 * `coldStart.ts` (M2): the `UNKNOWN`/`POSSIBLE_CANDIDATE` subset, kept
 * as-is — nothing in this codebase depends on it, so there is nothing to
 * migrate, and it remains a valid (if superseded) minimal reference.
 * `lifecycle.ts` (M4): the full eight-state FSM with hysteresis and
 * minimum dwell-time, driven by the Fusion Engine's posterior (M3). New
 * callers should use `LifecycleStateManager`.
 */
export type { ColdStartLifecycleState, ColdStartTransitionResult } from './coldStart.js';
export {
  COLD_START_STATES,
  ColdStartStateManager,
  evaluateColdStartTransition,
  hasWeakClaimMatchEvidence,
} from './coldStart.js';

export type {
  ContradictionSignal,
  LifecycleSessionRecord,
  LifecycleState,
  LifecycleTransitionResult,
  RecoveryAnnotation,
} from './lifecycle.js';
export {
  LIFECYCLE_STATES,
  LifecycleStateManager,
  evaluateLifecycleTransition,
  initialLifecycleRecord,
} from './lifecycle.js';
