import type { BundleName } from '@sherlock/contracts';

import type { FusionPosterior } from '../fusion/index.js';

/**
 * The full eight-state lifecycle (RFC §6, ADR-4) — the "eight-state
 * lifecycle from the brief... adopted, with one structural amendment":
 * `DISQUALIFIED` is "mandatory human review triggered," never "candidate
 * rejected" (ADR-3). This module supersedes M2's cold-start subset
 * (`coldStart.ts`, left untouched — nothing currently depends on it, so
 * there is nothing to migrate) for any caller that needs the real FSM.
 */
export const LIFECYCLE_STATES = [
  'UNKNOWN',
  'POSSIBLE_CANDIDATE',
  'LIKELY_CANDIDATE',
  'HIGHLY_CONFIDENT',
  'CONFIRMED',
  'LOST_CONFIDENCE',
  'DISQUALIFIED',
  'RECOVERED',
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/**
 * A stand-in for RFC §5's CUSUM/change-point layer, which does not exist
 * until Plan M9 (it runs on Visual/Audio embedding streams, neither of
 * which are built yet). This is deliberately *not* the eventual
 * `ChangePointEvent` domain entity (Plan §2) — that contract belongs to
 * whoever builds the real detector, once its actual statistical output
 * shape is known. This type is only the minimal input the FSM needs today
 * to exercise the `DISQUALIFIED` branch: an explicit, externally supplied
 * "a specific, strong contradiction was detected" fact (RFC §6), currently
 * always supplied by a caller (a test, for now) rather than a real
 * detector.
 */
export interface ContradictionSignal {
  readonly detectedAt: Date;
  readonly reason: string;
  readonly bundle?: BundleName;
  /**
   * RFC §6: `DISQUALIFIED` requires a change-point plus corroborating
   * cross-bundle evidence. When `false`, the FSM routes to
   * `LOST_CONFIDENCE` (ambiguous weakening) instead of mandatory review.
   */
  readonly corroborated: boolean;
}

export interface DisqualificationAnnotation {
  readonly disqualifiedAt: Date;
  readonly reason: string;
  readonly previousState: LifecycleState;
}

export interface RecoveryAnnotation {
  readonly recoveredAt: Date;
  readonly regressedFromState: LifecycleState;
}

/**
 * Everything the FSM needs to remember about one session between
 * evaluations. `recoveryAnnotations` is append-only and never cleared —
 * RFC §6: "`RECOVERED` is not silent amnesia... keeps a permanent
 * annotation in the audit trail" — even once `state` has climbed on past
 * `RECOVERED` to a higher tier.
 */
export interface LifecycleSessionRecord {
  readonly state: LifecycleState;
  readonly stateEnteredAt: Date;
  readonly recoveryAnnotations: readonly RecoveryAnnotation[];
  /** Permanent audit record of every `DISQUALIFIED` entry (RFC §6) — never cleared on human override. */
  readonly disqualificationAnnotations: readonly DisqualificationAnnotation[];
}

export interface LifecycleTransitionResult {
  readonly record: LifecycleSessionRecord;
  readonly transitioned: boolean;
  readonly reason: string;
}

export function initialLifecycleRecord(now: Date): LifecycleSessionRecord {
  return {
    state: 'UNKNOWN',
    stateEnteredAt: now,
    recoveryAnnotations: [],
    disqualificationAnnotations: [],
  };
}

type ClimbState = 'POSSIBLE_CANDIDATE' | 'LIKELY_CANDIDATE' | 'HIGHLY_CONFIDENT' | 'CONFIRMED';

interface ClimbTierConfig {
  readonly state: ClimbState;
  readonly rank: number;
  /** Stricter than `sustainProbability` — RFC §6: "the threshold to enter a tier is stricter than the threshold to fall out of it." */
  readonly enterProbability: number;
  /** Falling below this while at or above this tier is "evidence weakened" (§6) — routes to `LOST_CONFIDENCE`, not a one-tier-down step. */
  readonly sustainProbability: number;
  readonly minBundleDiversity: number;
  readonly minEligibleEventCount: number;
  readonly minDwellMs: number;
}

/**
 * Phase-1, hand-set climb thresholds — exactly the same "judgment, not
 * measurement, until enough labeled outcomes accumulate" caveat RFC §5
 * states for likelihood ratios applies here too (§6's own "Future
 * migration path": "only the numeric thresholds are expected to move as
 * real operating data accumulates"). Kept in one table, mirroring
 * `fusion/likelihoodRatios.ts`'s registry pattern, so recalibration is an
 * edit here, not a rewrite of the transition logic.
 *
 * `minBundleDiversity: 1` at `POSSIBLE_CANDIDATE` matches RFC §6's diagram
 * label exactly ("weak claim-match evidence" — a single bundle is
 * sufficient to leave `UNKNOWN`); `minBundleDiversity: 2` from
 * `LIKELY_CANDIDATE` up matches "consistent *multi-bundle* evidence."
 */
const CLIMB_TIERS: readonly ClimbTierConfig[] = [
  {
    state: 'POSSIBLE_CANDIDATE',
    rank: 1,
    enterProbability: 0.55,
    sustainProbability: 0.5,
    minBundleDiversity: 1,
    minEligibleEventCount: 1,
    minDwellMs: 0,
  },
  {
    state: 'LIKELY_CANDIDATE',
    rank: 2,
    enterProbability: 0.7,
    sustainProbability: 0.6,
    minBundleDiversity: 2,
    minEligibleEventCount: 3,
    minDwellMs: 60_000,
  },
  {
    state: 'HIGHLY_CONFIDENT',
    rank: 3,
    enterProbability: 0.85,
    sustainProbability: 0.75,
    minBundleDiversity: 2,
    minEligibleEventCount: 5,
    minDwellMs: 120_000,
  },
  {
    state: 'CONFIRMED',
    rank: 4,
    enterProbability: 0.95,
    sustainProbability: 0.88,
    minBundleDiversity: 2,
    minEligibleEventCount: 8,
    minDwellMs: 300_000,
  },
];

const RANK_BY_STATE: Readonly<Record<LifecycleState, number>> = {
  UNKNOWN: 0,
  POSSIBLE_CANDIDATE: 1,
  LIKELY_CANDIDATE: 2,
  HIGHLY_CONFIDENT: 3,
  CONFIRMED: 4,
  // Not part of the climb ladder's own numbering; handled by dedicated branches below.
  LOST_CONFIDENCE: -1,
  DISQUALIFIED: -1,
  RECOVERED: -1,
};

function tierConfigForRank(rank: number): ClimbTierConfig | undefined {
  return CLIMB_TIERS.find((tier) => tier.rank === rank);
}

function meetsTier(tier: ClimbTierConfig, posterior: FusionPosterior): boolean {
  return (
    posterior.probability >= tier.enterProbability &&
    posterior.bundleContributions.length >= tier.minBundleDiversity &&
    posterior.eligibleEventCount >= tier.minEligibleEventCount
  );
}

/** The highest-ranked tier above `fromRank` whose enter criteria are all satisfied, if any. */
function highestQualifyingTier(
  fromRank: number,
  posterior: FusionPosterior,
): ClimbTierConfig | undefined {
  let best: ClimbTierConfig | undefined;
  for (const tier of CLIMB_TIERS) {
    if (
      tier.rank > fromRank &&
      meetsTier(tier, posterior) &&
      (best === undefined || tier.rank > best.rank)
    ) {
      best = tier;
    }
  }
  return best;
}

function dwellElapsed(record: LifecycleSessionRecord, tier: ClimbTierConfig, now: Date): boolean {
  return now.getTime() - record.stateEnteredAt.getTime() >= tier.minDwellMs;
}

function enter(
  state: LifecycleState,
  now: Date,
  previous: LifecycleSessionRecord,
  reason: string,
): LifecycleTransitionResult {
  const disqualificationAnnotations =
    state === 'DISQUALIFIED'
      ? [
          ...previous.disqualificationAnnotations,
          {
            disqualifiedAt: now,
            reason,
            previousState: previous.state,
          },
        ]
      : previous.disqualificationAnnotations;

  return {
    record: {
      state,
      stateEnteredAt: now,
      recoveryAnnotations: previous.recoveryAnnotations,
      disqualificationAnnotations,
    },
    transitioned: true,
    reason,
  };
}

function hold(previous: LifecycleSessionRecord, reason: string): LifecycleTransitionResult {
  return { record: previous, transitioned: false, reason };
}

/**
 * Pure transition function: given a session's current lifecycle record,
 * the latest Fusion posterior (M3), the evaluation instant, and an
 * optional externally supplied contradiction signal, decides the next
 * lifecycle record.
 *
 * Evaluation order (RFC §6):
 * 1. `DISQUALIFIED` never transitions automatically (ADR-3) — only
 *    `applyHumanOverride` (below) moves a session out of it.
 * 2. A contradiction signal, from any other state, is "a specific, strong
 *    contradiction" (§6) and moves straight to `DISQUALIFIED` — the only
 *    state that triggers mandatory, urgent human escalation. (This is a
 *    deliberate generalization of the diagram's explicit
 *    `LOST_CONFIDENCE -> DISQUALIFIED` edge to "from any state," so a
 *    severe, well-corroborated contradiction is not artificially delayed
 *    by a mandatory `LOST_CONFIDENCE` waypoint — consistent with RFC
 *    §1/§12's real-time, act-while-it-still-matters framing. Documented
 *    here precisely because it is a judgment call, not a literal reading
 *    of the diagram.)
 * 3. From `LOST_CONFIDENCE`: if evidence has rebuilt to at least
 *    `POSSIBLE_CANDIDATE`'s bar, transition to `RECOVERED` and permanently
 *    record the annotation (§6, ADR-5). Otherwise, hold.
 * 4. From `UNKNOWN`, a climbing tier, or `RECOVERED` (treated as
 *    `POSSIBLE_CANDIDATE`'s rank for further climbing, per the diagram's
 *    loop-back into "any state above"): if the current tier's evidence has
 *    weakened below its *sustain* threshold, that is "evidence weakened or
 *    went quiet" (§6) — route to `LOST_CONFIDENCE`. Otherwise, once the
 *    current tier's minimum dwell time has elapsed, climb to the highest
 *    qualifying tier above it, if any.
 */
export function evaluateLifecycleTransition(
  current: LifecycleSessionRecord,
  posterior: FusionPosterior,
  now: Date,
  contradiction?: ContradictionSignal,
): LifecycleTransitionResult {
  if (current.state === 'DISQUALIFIED') {
    return hold(
      current,
      'DISQUALIFIED requires an explicit human override; no automatic transition (ADR-3)',
    );
  }

  if (contradiction !== undefined) {
    const targetState = contradiction.corroborated ? 'DISQUALIFIED' : 'LOST_CONFIDENCE';
    const reason = contradiction.corroborated
      ? `specific, strong contradiction detected: ${contradiction.reason} (RFC §6 -- mandatory human review triggered)`
      : `change-point without cross-bundle corroboration: ${contradiction.reason} (RFC §6 -- evidence weakened, not yet disqualified)`;
    return enter(targetState, now, current, reason);
  }

  if (current.state === 'LOST_CONFIDENCE') {
    const possibleCandidateTier = tierConfigForRank(1) as ClimbTierConfig;
    if (meetsTier(possibleCandidateTier, posterior)) {
      const recovered: LifecycleSessionRecord = {
        state: 'RECOVERED',
        stateEnteredAt: now,
        recoveryAnnotations: [
          ...current.recoveryAnnotations,
          { recoveredAt: now, regressedFromState: 'LOST_CONFIDENCE' },
        ],
        disqualificationAnnotations: current.disqualificationAnnotations,
      };
      return {
        record: recovered,
        transitioned: true,
        reason: 'evidence rebuilt past the POSSIBLE_CANDIDATE bar (RFC §6)',
      };
    }
    return hold(current, 'evidence has not yet rebuilt; remaining at LOST_CONFIDENCE');
  }

  // UNKNOWN, any climbing tier, or RECOVERED (treated at POSSIBLE_CANDIDATE's rank: 1, not 0 --
  // using 0 here would make `highestQualifyingTier` immediately "re-qualify" POSSIBLE_CANDIDATE
  // itself on the very next evaluation with no new evidence, silently erasing the RECOVERED
  // label the instant its zero-dwell tier's criteria are re-checked).
  const effectiveRank =
    current.state === 'RECOVERED' ? 1 : (RANK_BY_STATE[current.state] as number);
  const currentTier = current.state === 'UNKNOWN' ? undefined : tierConfigForRank(effectiveRank);

  if (currentTier !== undefined && posterior.probability < currentTier.sustainProbability) {
    return enter(
      'LOST_CONFIDENCE',
      now,
      current,
      `evidence weakened below the ${currentTier.state} sustain bar (RFC §6)`,
    );
  }

  if (currentTier !== undefined && !dwellElapsed(current, currentTier, now)) {
    return hold(
      current,
      `minimum dwell time for ${currentTier.state} has not yet elapsed (RFC §6 hysteresis)`,
    );
  }

  const qualifyingTier = highestQualifyingTier(effectiveRank, posterior);
  if (qualifyingTier === undefined) {
    return hold(current, `no higher tier's criteria are met yet from ${current.state}`);
  }
  return enter(
    qualifyingTier.state,
    now,
    current,
    `criteria met for ${qualifyingTier.state} (RFC §6)`,
  );
}

/**
 * Per-session lifecycle state holder (RFC §6; M4's version of M2's
 * `ColdStartStateManager`, extended to the full eight states).
 */
export class LifecycleStateManager {
  private readonly records = new Map<string, LifecycleSessionRecord>();

  getRecord(sessionId: string, now: Date = new Date()): LifecycleSessionRecord {
    return this.records.get(sessionId) ?? initialLifecycleRecord(now);
  }

  getState(sessionId: string): LifecycleState {
    return this.records.get(sessionId)?.state ?? 'UNKNOWN';
  }

  /**
   * Primes this session's in-memory record directly, without running it
   * through `evaluateLifecycleTransition`. The one legitimate caller is
   * session-state *recovery* (Plan M7): a replica that has not yet seen
   * this session loads its last durable snapshot (`SessionSnapshotRepository`,
   * M1) and restores exactly that record here, rather than starting the
   * session over at `UNKNOWN`. Never used to bypass the FSM's own
   * transition rules for a session already known to this manager.
   */
  restoreRecord(sessionId: string, record: LifecycleSessionRecord): void {
    this.records.set(sessionId, record);
  }

  evaluate(
    sessionId: string,
    posterior: FusionPosterior,
    now: Date = new Date(),
    contradiction?: ContradictionSignal,
  ): LifecycleTransitionResult {
    const current = this.getRecord(sessionId, now);
    const result = evaluateLifecycleTransition(current, posterior, now, contradiction);
    this.records.set(sessionId, result.record);
    return result;
  }

  /**
   * The only way a session leaves `DISQUALIFIED` (ADR-3; Plan §2's
   * `HumanOverrideAction`). This milestone only proves the invariant holds
   * structurally (nothing but this method can move a `DISQUALIFIED`
   * session anywhere) — the full `HumanOverrideAction` entity, audit trail,
   * and reviewer-facing API are Plan M13's job.
   */
  applyHumanOverride(
    sessionId: string,
    nextState: LifecycleState,
    now: Date = new Date(),
    reason = 'human override',
  ): LifecycleTransitionResult {
    const current = this.getRecord(sessionId, now);
    const result = enter(nextState, now, current, reason);
    this.records.set(sessionId, result.record);
    return result;
  }

  /**
   * Every session this replica currently holds in memory, by state. Plan
   * M13's "UNKNOWN-rate aggregate view" (RFC §10's Committee Note: "an
   * unusually high rate of `UNKNOWN` sessions from one source... is
   * itself an aggregate anomaly worth surfacing") reads this. Scoped to
   * this single replica's in-memory sessions only — see
   * `SessionOrchestrationService`'s own doc comment for why this is an
   * honest, stated limitation rather than a cross-replica aggregate.
   */
  getAllStates(): ReadonlyMap<string, LifecycleState> {
    return new Map(Array.from(this.records, ([sessionId, record]) => [sessionId, record.state]));
  }
}
