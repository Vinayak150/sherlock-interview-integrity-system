import type { ClaimMatchValue, NewEvidenceEvent } from '@sherlock/contracts';

/**
 * The M2-scoped subset of RFC §6's eight-state lifecycle (Plan M2: "a State
 * Manager that only ever reaches UNKNOWN/POSSIBLE_CANDIDATE").
 *
 * This is deliberately not the full FSM. No hysteresis, no minimum
 * dwell-time, no `LIKELY_CANDIDATE`/`HIGHLY_CONFIDENT`/`CONFIRMED`, no
 * `LOST_CONFIDENCE`/`DISQUALIFIED`/`RECOVERED`, and no change-point
 * handling — all of that arrives at M4, once the Fusion Engine (M3) exists
 * to actually drive it with a real Beta posterior. Building the full FSM
 * against a fusion engine that doesn't exist yet would be reasoning ahead
 * of the evidence this milestone actually has available (RFC §6 committee
 * intent: thresholds and states track real signal availability).
 *
 * Every session starts at `UNKNOWN` regardless of when it joins (RFC §11
 * "Late joiners": "the state machine already starts at UNKNOWN and only
 * climbs with evidence, regardless of when"). This subset only ever climbs,
 * never regresses — regression is itself a state (`LOST_CONFIDENCE`) this
 * subset does not implement.
 */
export const COLD_START_STATES = ['UNKNOWN', 'POSSIBLE_CANDIDATE'] as const;

export type ColdStartLifecycleState = (typeof COLD_START_STATES)[number];

export interface ColdStartTransitionResult {
  readonly state: ColdStartLifecycleState;
  readonly transitioned: boolean;
  readonly reason: string;
}

/**
 * The three Claim bundle (RFC §4-A) signals that represent a comparison
 * against the filed identity claim, as opposed to a presence check. Only
 * these can supply "claim-match evidence" for the §6 UNKNOWN ->
 * POSSIBLE_CANDIDATE edge — a reference photo merely *existing* on file
 * says nothing about whether the person on this call matches anything.
 */
const CLAIM_MATCH_SIGNAL_NAMES = new Set([
  'display_name_match',
  'email_domain_match',
  'calendar_invite_match',
]);

function isClaimMatchValue(value: unknown): value is ClaimMatchValue {
  return typeof value === 'object' && value !== null && 'matched' in value;
}

/**
 * "Weak claim-match evidence" (RFC §6 state-machine diagram, the UNKNOWN ->
 * POSSIBLE_CANDIDATE edge): at least one Claim bundle signal reporting a
 * confirmed match with signal-health `OK`.
 *
 * `SERVICE_UNAVAILABLE` evidence is excluded entirely, per §13's contract —
 * an ATS outage must never be able to manufacture, or block, a state
 * transition on its own. `NO_SIGNAL_DETECTED` (e.g. no calendar invite on
 * file) is neither a match nor a contradiction, so it contributes nothing
 * here either — consistent with §7's "absence of evidence, not evidence of
 * absence."
 */
export function hasWeakClaimMatchEvidence(claimEvidence: readonly NewEvidenceEvent[]): boolean {
  return claimEvidence.some((event) => {
    if (event.bundle !== 'claim') return false;
    if (event.healthStatus !== 'OK') return false;
    if (!CLAIM_MATCH_SIGNAL_NAMES.has(event.signalName)) return false;
    return isClaimMatchValue(event.value) && event.value.matched === true;
  });
}

/**
 * Pure transition function: given the current (M2-subset) state and the
 * Claim bundle evidence accumulated so far for a session, decides the next
 * state.
 *
 * Metadata bundle evidence (this milestone's other adapter) is
 * deliberately not an input here: RFC §6's diagram gates UNKNOWN ->
 * POSSIBLE_CANDIDATE specifically on claim-match evidence. Metadata is a
 * Tier 2/supportive bundle (§13) that folds into the full Bayesian log-odds
 * sum starting at M3 — it is captured (`MetadataBundleAdapter`) but does
 * not, on its own, drive a lifecycle transition in this cold-start subset.
 */
export function evaluateColdStartTransition(
  currentState: ColdStartLifecycleState,
  claimEvidence: readonly NewEvidenceEvent[],
): ColdStartTransitionResult {
  if (currentState === 'POSSIBLE_CANDIDATE') {
    return {
      state: 'POSSIBLE_CANDIDATE',
      transitioned: false,
      reason: 'already at POSSIBLE_CANDIDATE',
    };
  }

  if (hasWeakClaimMatchEvidence(claimEvidence)) {
    return {
      state: 'POSSIBLE_CANDIDATE',
      transitioned: true,
      reason: 'weak claim-match evidence observed (RFC §6)',
    };
  }

  return { state: 'UNKNOWN', transitioned: false, reason: 'no claim-match evidence yet' };
}

/**
 * Per-session state holder for the cold-start subset. A minimal,
 * in-memory stand-in for the full State Manager (§6, M4) — session
 * snapshotting/recovery (§9.3's tables, M1; M7's routing) is intentionally
 * not wired to this subset, since the state it holds here is wholesale
 * superseded once the real eight-state FSM lands at M4.
 */
export class ColdStartStateManager {
  private readonly states = new Map<string, ColdStartLifecycleState>();

  /** A session not yet seen is, by construction, `UNKNOWN` (RFC §11 cold-start invariant). */
  getState(sessionId: string): ColdStartLifecycleState {
    return this.states.get(sessionId) ?? 'UNKNOWN';
  }

  recordClaimEvidence(
    sessionId: string,
    claimEvidence: readonly NewEvidenceEvent[],
  ): ColdStartTransitionResult {
    const result = evaluateColdStartTransition(this.getState(sessionId), claimEvidence);
    this.states.set(sessionId, result.state);
    return result;
  }
}
