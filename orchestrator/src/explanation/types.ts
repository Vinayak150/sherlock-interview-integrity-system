import type { BundleName } from '@sherlock/contracts';

import type { SignalOutcome } from '../fusion/index.js';
import type { LifecycleState } from '../statemachine/index.js';

/**
 * One evidence event's decayed contribution at report-generation time,
 * ready to be ranked (RFC §8: "Top contributing signals, ranked by
 * `|log LR|` contribution ... a direct, non-approximated readout of the
 * fusion math, in plain language"). "In plain language" is the
 * constrained-LLM narrative layer's job (Plan M12) — this is the
 * structured fact it would eventually be handed, not the prose itself.
 */
export interface ContributingSignal {
  readonly bundle: BundleName;
  readonly signalName: string;
  readonly outcome: SignalOutcome;
  /** Signed, decayed at `EvidenceReport.generatedAt` — the same decay function the Fusion Engine (M3) itself uses. */
  readonly decayedLogLikelihoodRatio: number;
  readonly occurredAt: Date;
}

/**
 * An event whose health status was `NO_SIGNAL_DETECTED` or
 * `SERVICE_UNAVAILABLE` (RFC §8: "Missing evidence — what's unavailable
 * and why ... explicitly separated from 'evidence against'"). Never mixed
 * into `contradictoryEvidence` or `topContributingSignals` — that
 * separation is the entire point of this list existing at all.
 */
export interface MissingEvidenceItem {
  readonly bundle: BundleName;
  readonly signalName: string;
  readonly healthStatus: 'NO_SIGNAL_DETECTED' | 'SERVICE_UNAVAILABLE';
  readonly occurredAt: Date;
}

/**
 * The structured Evidence Report (RFC §8; Plan M6). Deterministically
 * built from Fusion Engine (M3) and persisted-evidence (M1) facts only —
 * "guaranteed accurate by construction, never touched by a model that
 * could hallucinate them" (RFC §8). The prose narrative layer described in
 * the same RFC section is Plan M12's job, not this type's.
 */
export interface EvidenceReport {
  readonly sessionId: string;
  readonly generatedAt: Date;
  readonly lifecycleState: LifecycleState;
  readonly probability: number;
  /** Ranked descending by `|decayedLogLikelihoodRatio|` — RFC §8's "evidence ordering." */
  readonly topContributingSignals: readonly ContributingSignal[];
  readonly contradictoryEvidence: readonly ContributingSignal[];
  readonly missingEvidence: readonly MissingEvidenceItem[];
  /**
   * RFC §8: "Alternative hypotheses considered, in two distinct senses:
   * (a) benign explanations for the same evidence ... (b) role
   * assignment." Both require signal families (visual/audio for benign
   * technical explanations; turn-taking/role data for (b)) that do not
   * exist yet (Plan M9-M11). Deliberately left empty rather than
   * fabricated — this list becomes populated once those bundles land, not
   * before.
   */
  readonly alternativeHypotheses: readonly string[];
}
