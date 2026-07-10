import type { EvidenceEvent } from '@sherlock/contracts';

import type { FusionPosterior } from '../fusion/index.js';
import type { LifecycleTransitionResult } from '../statemachine/index.js';
import type {
  Alert,
  AlertSeverity,
  Decision,
  ElicitationTrigger,
  EvidenceReference,
  ReviewerRecommendation,
} from './types.js';

/**
 * RFC §10 abstention threshold. Phase-1, hand-set — the same "judgment,
 * not measurement" caveat that applies to `fusion/likelihoodRatios.ts` and
 * `statemachine/lifecycle.ts`'s `CLIMB_TIERS` applies here too.
 * Deliberately independent of the Lifecycle FSM's own `POSSIBLE_CANDIDATE`
 * enter threshold, so the Decision Engine never needs to know the FSM's
 * internal tier structure — only the posterior and lifecycle state it is
 * handed.
 *
 * Per explicit instruction, this is the *only* abstention policy
 * implemented: "If confidence remains below the configured threshold,
 * emit UNKNOWN and recommend human review." The RFC's own Committee Note
 * (§10) is explicit that abstention-gaming is "a real risk, not fully
 * closed by this design ... flagged as an open risk requiring
 * product-level attention — disclosure requirements, a minimum-signal
 * policy per customer — not a fully engineered answer." That calibration
 * work is deliberately NOT done here. No anti-gaming heuristic, no
 * minimum-signal policy, no aggregate `UNKNOWN`-rate anomaly detection is
 * implemented in this module — exactly as deferred by the RFC itself, not
 * as an oversight.
 */
export const DEFAULT_ABSTENTION_PROBABILITY_THRESHOLD = 0.55;

/** RFC §10 tie-breaking: "genuinely near 0.5" — the probability band around the midpoint that counts as "near." */
export const DEFAULT_AMBIGUOUS_PROBABILITY_BAND = 0.05;

/** RFC §10 tie-breaking: "with a tight interval" — a credible-interval width at or below this counts as tight (i.e. confidently, not sparsely, ambiguous). */
export const DEFAULT_AMBIGUOUS_MAX_INTERVAL_WIDTH = 0.3;

export interface DecisionEngineOptions {
  readonly abstentionProbabilityThreshold?: number;
  readonly ambiguousProbabilityBand?: number;
  readonly ambiguousMaxIntervalWidth?: number;
}

function assertUnitInterval(name: string, value: number): void {
  if (!(value >= 0 && value <= 1)) {
    throw new RangeError(`${name} must be within [0, 1], received ${value}`);
  }
}

/**
 * "Confidently ambiguous" (RFC §10): near 0.5 *and* the credible interval
 * is already tight — i.e. not merely under-evidenced. A sparse-but-near-0.5
 * posterior (wide interval) is not this; it is ordinary early-session
 * uncertainty and is left to keep accumulating evidence.
 */
function isConfidentlyAmbiguous(
  posterior: FusionPosterior,
  band: number,
  maxWidth: number,
): boolean {
  const nearMidpoint = Math.abs(posterior.probability - 0.5) <= band;
  const width = posterior.credibleInterval.upper - posterior.credibleInterval.lower;
  return nearMidpoint && width <= maxWidth;
}

export interface DecisionInput {
  readonly sessionId: string;
  readonly transition: LifecycleTransitionResult;
  readonly posterior: FusionPosterior;
  readonly evidence: readonly EvidenceEvent[];
  readonly now?: Date;
}

export interface DecisionOutcome {
  readonly decision: Decision;
  readonly ambiguousNow: boolean;
}

function buildAlert(
  sessionId: string,
  raisedAt: Date,
  severity: AlertSeverity,
  reason: string,
  lifecycleState: Decision['lifecycleState'],
  evidenceRef: EvidenceReference,
): Alert {
  return { sessionId, raisedAt, severity, reason, lifecycleState, evidenceRef };
}

/**
 * Pure decision function for one evaluation tick (RFC §10; Plan M5:
 * Decision Engine, alert generation, abstention logic, reviewer
 * recommendation). `wasAmbiguous` is the only piece of cross-tick memory
 * this needs (RFC §1's alert-fatigue concern: an ongoing ambiguous
 * posterior should alert once on entry, not every tick) — every other
 * alert (`DISQUALIFIED`/`LOST_CONFIDENCE`/`RECOVERED`) is gated on
 * `transition.transitioned`, which the Lifecycle FSM (M4) already
 * computes, so no additional dedup bookkeeping is needed for those.
 *
 * This function never builds a report: `evidenceRef` is a raw,
 * unformatted snapshot (immutable evidence + posterior), never signal
 * rankings, contradiction summaries, or prose. That is the Evidence Report
 * Engine's job (M6) — this module has no import from `explanation/` and
 * never will.
 */
export function decideForSession(
  input: DecisionInput,
  wasAmbiguous: boolean,
  options: DecisionEngineOptions = {},
): DecisionOutcome {
  const now = input.now ?? new Date();
  const abstentionThreshold =
    options.abstentionProbabilityThreshold ?? DEFAULT_ABSTENTION_PROBABILITY_THRESHOLD;
  const ambiguousBand = options.ambiguousProbabilityBand ?? DEFAULT_AMBIGUOUS_PROBABILITY_BAND;
  const ambiguousMaxWidth =
    options.ambiguousMaxIntervalWidth ?? DEFAULT_AMBIGUOUS_MAX_INTERVAL_WIDTH;
  assertUnitInterval('abstentionProbabilityThreshold', abstentionThreshold);
  assertUnitInterval('ambiguousProbabilityBand', ambiguousBand);

  const state = input.transition.record.state;
  const posterior = input.posterior;

  const evidenceRef: EvidenceReference = {
    sessionId: input.sessionId,
    capturedAt: now,
    events: [...input.evidence],
    posterior,
  };

  let abstained = false;
  let ambiguousNow = false;
  let recommendation: ReviewerRecommendation = 'NONE';
  let alert: Alert | null = null;
  let elicitationTrigger: ElicitationTrigger | null = null;

  if (state === 'DISQUALIFIED') {
    recommendation = 'MANDATORY_REVIEW';
    if (input.transition.transitioned) {
      alert = buildAlert(
        input.sessionId,
        now,
        'URGENT',
        'DISQUALIFIED: specific, strong contradiction detected -- mandatory human review triggered (ADR-3)',
        state,
        evidenceRef,
      );
      // RFC §11's edge-case fallbacks recommend an unscripted elicitation challenge alongside
      // -- not instead of -- the mandatory review, to gather corroborating (or exonerating)
      // evidence for the reviewer. The originating bundle (visual vs. audio) is not threaded
      // into this input, so a single, generic challenge type is used here rather than
      // fabricating a distinction this engine cannot actually make.
      elicitationTrigger = {
        challengeType: 'unscripted_statement',
        reason:
          'specific, strong contradiction detected -- RFC §11 recommends an unscripted challenge alongside mandatory review',
      };
    }
  } else if (state === 'LOST_CONFIDENCE') {
    recommendation = 'MONITOR';
    if (input.transition.transitioned) {
      alert = buildAlert(
        input.sessionId,
        now,
        'INFO',
        'LOST_CONFIDENCE: evidence weakened or went quiet -- ambiguous, not damning (RFC §6)',
        state,
        evidenceRef,
      );
    }
  } else if (state === 'UNKNOWN' && posterior.probability < abstentionThreshold) {
    // RFC §10: "a session where camera, mic, and client agent were never meaningfully
    // available produces UNKNOWN -- insufficient evidence ... Abstention routes the session
    // to ordinary human interview judgment, unflagged." No alert, by design.
    abstained = true;
    recommendation = 'DEFER_TO_ORDINARY_JUDGMENT';
  } else if (isConfidentlyAmbiguous(posterior, ambiguousBand, ambiguousMaxWidth)) {
    ambiguousNow = true;
    recommendation = 'ADJUDICATE';
    if (!wasAmbiguous) {
      alert = buildAlert(
        input.sessionId,
        now,
        'INFO',
        'AMBIGUOUS -- needs adjudication: confidently ambiguous posterior (RFC §10)',
        state,
        evidenceRef,
      );
      // RFC §10: "It escalates to active elicitation (§4-G) first; if still ambiguous, it
      // surfaces an explicit AMBIGUOUS ... tag." This trigger accompanies that first escalation.
      elicitationTrigger = {
        challengeType: 'repeat_phrase',
        reason:
          'confidently ambiguous posterior -- RFC §10 escalates to active elicitation before surfacing AMBIGUOUS',
      };
    }
  } else if (state === 'RECOVERED' && input.transition.transitioned) {
    alert = buildAlert(
      input.sessionId,
      now,
      'INFO',
      'RECOVERED: evidence rebuilt after a dip -- permanently annotated in the audit trail (RFC §6, ADR-5)',
      state,
      evidenceRef,
    );
  }

  const decision: Decision = {
    sessionId: input.sessionId,
    decidedAt: now,
    lifecycleState: state,
    abstained,
    ambiguous: ambiguousNow,
    reviewerRecommendation: recommendation,
    alert,
    elicitationTrigger,
    evidenceRef,
  };

  return { decision, ambiguousNow };
}

/**
 * Per-session stateful wrapper (same pattern as `FusionEngine` /
 * `LifecycleStateManager`), holding only the minimal cross-tick memory
 * `decideForSession` needs: whether the previous tick was already
 * confidently ambiguous, so alerts dedupe on the false -> true edge rather
 * than firing every tick a session remains ambiguous.
 */
export class DecisionEngine {
  private readonly wasAmbiguousBySession = new Map<string, boolean>();

  constructor(private readonly options: DecisionEngineOptions = {}) {}

  decide(input: DecisionInput): Decision {
    const wasAmbiguous = this.wasAmbiguousBySession.get(input.sessionId) ?? false;
    const { decision, ambiguousNow } = decideForSession(input, wasAmbiguous, this.options);
    this.wasAmbiguousBySession.set(input.sessionId, ambiguousNow);
    return decision;
  }
}
