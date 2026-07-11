import type { BundleName } from '@sherlock/contracts';

import type { FusionPosterior, SignalOutcome } from '../fusion/index.js';
import type { SessionEvidenceClassification } from '../evidenceClassification/index.js';
import type { SessionContradictionMetrics } from './contradictionMetrics.js';
import type { ParticipantCrossModalMetrics, SessionCrossModalMetrics } from './crossModalConsistency.js';

/**
 * One decay-weighted signal that materially moved a participant's posterior.
 * Mirrors the Explanation Engine's contributor ranking without coupling to
 * that module (which must remain unchanged per assignment scope).
 */
export interface EvidenceContributor {
  readonly eventId: string | null;
  readonly bundle: BundleName;
  readonly signalName: string;
  readonly outcome: SignalOutcome;
  readonly decayedLogLikelihoodRatio: number;
  readonly occurredAt: Date;
}

/** Per-participant identification state derived from the abstention threshold. */
export type CandidateIdentificationState = 'IDENTIFIED' | 'UNKNOWN';

/**
 * One row in the internal ranked candidate table. `participantId` is the
 * ATS/filed candidate identity being scored — not a video-call UID.
 */
export interface RankedCandidate {
  readonly participantId: string;
  readonly probability: number;
  /** Calibrated point estimate — identical to `probability` (RFC §5). */
  readonly confidence: number;
  /** Credible-interval width: wider means more uncertain (RFC §5). */
  readonly uncertainty: number;
  readonly lastUpdated: Date;
  readonly identificationState: CandidateIdentificationState;
  readonly topEvidenceContributors: readonly EvidenceContributor[];
  /** Full posterior kept for internal selection; never exposed on public APIs. */
  readonly posterior: FusionPosterior;
  /** Cross-modal identity consistency for this hypothesis — internal only. */
  readonly crossModal: ParticipantCrossModalMetrics | null;
}

/**
 * Internal ranked table for one session at one evaluation instant. Not part
 * of any HTTP response or persistence schema — lives only in orchestrator
 * memory for the duration of the process.
 */
export interface CandidateConfidenceTable {
  readonly sessionId: string;
  readonly evaluatedAt: Date;
  readonly rankedCandidates: readonly RankedCandidate[];
  /** Top-ranked participant, or `null` when the table is empty. */
  readonly topParticipantId: string | null;
}

export interface CandidateConfidenceEvaluation {
  readonly table: CandidateConfidenceTable;
  /** Posterior passed to lifecycle + decision — top candidate, or session-wide fusion when unranked. */
  readonly selectedPosterior: FusionPosterior;
  /** Explicit SUPPORTS / CONTRADICTS / NEUTRAL classification per candidate hypothesis. */
  readonly classification: SessionEvidenceClassification;
  /** Decay-weighted agreement/contradiction/consistency metrics per hypothesis. */
  readonly contradictionMetrics: SessionContradictionMetrics;
  /** Face / speaker / metadata / transcript identity consistency per hypothesis. */
  readonly crossModalMetrics: SessionCrossModalMetrics;
}
