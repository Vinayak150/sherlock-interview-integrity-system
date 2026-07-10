import type { ElicitationChallengeType, EvidenceEvent } from '@sherlock/contracts';

import type { FusionPosterior } from '../fusion/index.js';
import type { LifecycleState } from '../statemachine/index.js';

/**
 * What the Decision Engine tells a reviewer to do (Plan M5: "Reviewer
 * recommendation"). Deliberately not a narrative — that is the Evidence
 * Report Engine's job (M6); this is a closed enum a UI can branch on
 * directly.
 */
export type ReviewerRecommendation =
  'NONE' | 'DEFER_TO_ORDINARY_JUDGMENT' | 'MONITOR' | 'ADJUDICATE' | 'MANDATORY_REVIEW';

/** RFC §1: alerts are meant to be low-noise; `URGENT` is reserved for the one state that triggers mandatory, urgent human escalation (RFC §6) — `DISQUALIFIED`. Everything else this module raises is `INFO`. */
export type AlertSeverity = 'INFO' | 'URGENT';

/**
 * An immutable snapshot of the evidence a `Decision` was based on (Plan
 * M5: "Immutable evidence references"). `events` is a defensive copy of
 * already-persisted (`EvidenceEvent`, immutable-once-written per
 * `@sherlock/contracts`) records, taken at decision time — later mutation
 * of the caller's array can never retroactively change what this decision
 * saw. This is what the Evidence Report Engine (M6) later reads to build
 * the actual report; the Decision Engine itself never interprets or
 * formats this content beyond the posterior (M3) it is handed.
 */
export interface EvidenceReference {
  readonly sessionId: string;
  readonly capturedAt: Date;
  readonly events: readonly EvidenceEvent[];
  readonly posterior: FusionPosterior;
}

/**
 * A low-noise, reviewer-facing notification (RFC §1: "Surface low-noise,
 * real-time alerts to the interviewer/reviewer, never to the candidate").
 * `reason` is a short, machine-generated label, not an explanation —
 * building the human-readable Evidence Report from `evidenceRef` is the
 * Evidence Report Engine's job (M6), never this one's. The Decision
 * Engine must never generate reports.
 */
export interface Alert {
  readonly sessionId: string;
  readonly raisedAt: Date;
  readonly severity: AlertSeverity;
  readonly reason: string;
  readonly lifecycleState: LifecycleState;
  readonly evidenceRef: EvidenceReference;
}

/**
 * Plan M11's "trigger wiring from Decision Engine into Interviewer UI
 * prompts": RFC §10's tie-breaking escalates to active elicitation
 * *before* surfacing `AMBIGUOUS`, and §11's edge-case fallbacks recommend
 * an unscripted challenge alongside a `DISQUALIFIED` mandatory-review
 * escalation. This is the recommendation only — actually delivering the
 * prompt to a candidate/interviewer is the Interviewer UI's job (Plan
 * M13, not built here); observing the response is the Elicitation Bundle
 * Adapter's job (M11), feeding back in as ordinary evidence on a later
 * tick.
 */
export interface ElicitationTrigger {
  readonly challengeType: ElicitationChallengeType;
  readonly reason: string;
}

/**
 * The Decision Engine's structured output for one evaluation (Plan M5:
 * "Structured Decision object"). One `Decision` is produced per lifecycle
 * evaluation; `alert` is `null` on ticks where nothing newly alert-worthy
 * occurred (most ticks, by design — RFC §1's "low-noise" requirement).
 */
export interface Decision {
  readonly sessionId: string;
  readonly decidedAt: Date;
  readonly lifecycleState: LifecycleState;
  /** RFC §10: "Abstention is a first-class output, distinct from LOST_CONFIDENCE." */
  readonly abstained: boolean;
  /** RFC §10 tie-breaking: "genuinely near 0.5 *with a tight interval* — confidently ambiguous." */
  readonly ambiguous: boolean;
  readonly reviewerRecommendation: ReviewerRecommendation;
  readonly alert: Alert | null;
  /** Plan M11. `null` on the (large majority of) ticks with nothing new to escalate. */
  readonly elicitationTrigger: ElicitationTrigger | null;
  readonly evidenceRef: EvidenceReference;
}
