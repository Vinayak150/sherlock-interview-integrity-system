import type { BundleName, SignalHealthStatus } from '@sherlock/contracts';

import type {
  ContradictionRecord,
  ParticipantContradictionMetrics,
  SessionContradictionMetrics,
} from '../candidateConfidence/contradictionMetrics.js';
import type { SessionEvidenceClassification } from '../evidenceClassification/index.js';
import type { ContributingSignal, MissingEvidenceItem } from './types.js';

const DEFAULT_MAX_STRONGEST = 3;
const UNCERTAINTY_INCREASE_THRESHOLD = 0.5;
const RECOVERED_CONTRADICTION_DECAY_THRESHOLD = 0.99;

/** Machine-readable reason codes — structured data only, never narrative prose. */
export type ConfidenceReasonKind =
  | 'SUPPORTING_EVIDENCE'
  | 'CONTRADICTING_EVIDENCE'
  | 'DECAYED_CONTRADICTION'
  | 'MISSING_EVIDENCE'
  | 'IGNORED_NEUTRAL_EVIDENCE'
  | 'WIDE_CREDIBLE_INTERVAL';

export interface StructuredConfidenceReason {
  readonly kind: ConfidenceReasonKind;
  readonly bundle: BundleName;
  readonly signalName: string;
  readonly participantId: string | null;
}

export interface IgnoredEvidenceItem {
  readonly bundle: BundleName;
  readonly signalName: string;
  readonly healthStatus: SignalHealthStatus;
  readonly occurredAt: Date;
}

/**
 * Contradiction-aware enrichment for `StructuredEvidenceSummary`. All
 * scores and contradiction records are reused from
 * `SessionContradictionMetrics` — this module never recomputes them.
 */
export interface ContradictionReasoningSummary {
  readonly participantId: string | null;
  readonly strongestAgreements: readonly ContributingSignal[];
  readonly strongestContradictions: readonly ContradictionRecord[];
  readonly ignoredEvidence: readonly IgnoredEvidenceItem[];
  readonly evidenceConsistency: number;
  readonly agreementScore: number;
  readonly contradictionScore: number;
  readonly consistencyScore: number;
  readonly reasonsConfidenceIncreased: readonly StructuredConfidenceReason[];
  readonly reasonsConfidenceDecreased: readonly StructuredConfidenceReason[];
  readonly reasonsUncertaintyIncreased: readonly StructuredConfidenceReason[];
}

export interface BuildContradictionReasoningInput {
  readonly contradictionMetrics?: SessionContradictionMetrics;
  readonly classification?: SessionEvidenceClassification;
  readonly contributingSignals: readonly ContributingSignal[];
  readonly missingEvidence: readonly MissingEvidenceItem[];
  readonly uncertainty: number;
  readonly topParticipantId?: string | null;
  readonly maxStrongest?: number;
}

function selectParticipantMetrics(
  metrics: SessionContradictionMetrics,
  topParticipantId: string | null | undefined,
): ParticipantContradictionMetrics | null {
  if (topParticipantId !== null && topParticipantId !== undefined) {
    return metrics.byParticipant.find((row) => row.participantId === topParticipantId) ?? null;
  }
  return metrics.byParticipant[0] ?? null;
}

function ignoredFromClassification(
  classification: SessionEvidenceClassification | undefined,
  participantId: string | null,
): IgnoredEvidenceItem[] {
  if (classification === undefined) return [];

  const participant =
    participantId === null
      ? classification.byParticipant[0]
      : classification.byParticipant.find((row) => row.participantId === participantId);

  if (participant === undefined) return [];

  return participant.items
    .filter((item) => item.classification === 'NEUTRAL')
    .map((item) => ({
      bundle: item.bundle,
      signalName: item.signalName,
      healthStatus: item.healthStatus,
      occurredAt: item.occurredAt,
    }));
}

function strongestAgreements(
  contributingSignals: readonly ContributingSignal[],
  max: number,
): ContributingSignal[] {
  return [...contributingSignals]
    .filter((signal) => signal.outcome === 'SUPPORTS')
    .sort((a, b) => b.decayedLogLikelihoodRatio - a.decayedLogLikelihoodRatio)
    .slice(0, max);
}

function reasonsConfidenceIncreased(
  agreements: readonly ContributingSignal[],
  participantId: string | null,
): StructuredConfidenceReason[] {
  return agreements.map((signal) => ({
    kind: 'SUPPORTING_EVIDENCE',
    bundle: signal.bundle,
    signalName: signal.signalName,
    participantId,
  }));
}

function reasonsConfidenceDecreased(
  contradictions: readonly ContradictionRecord[],
  participantId: string | null,
): StructuredConfidenceReason[] {
  return contradictions.map((record) => ({
    kind:
      record.decayWeight < RECOVERED_CONTRADICTION_DECAY_THRESHOLD
        ? 'DECAYED_CONTRADICTION'
        : 'CONTRADICTING_EVIDENCE',
    bundle: record.evidenceSource.bundle,
    signalName: record.evidenceSource.signalName,
    participantId: record.conflictingParticipantId ?? participantId,
  }));
}

function reasonsUncertaintyIncreased(
  missingEvidence: readonly MissingEvidenceItem[],
  ignoredEvidence: readonly IgnoredEvidenceItem[],
  uncertainty: number,
  participantId: string | null,
): StructuredConfidenceReason[] {
  const reasons: StructuredConfidenceReason[] = [];

  for (const item of missingEvidence) {
    reasons.push({
      kind: 'MISSING_EVIDENCE',
      bundle: item.bundle,
      signalName: item.signalName,
      participantId,
    });
  }

  for (const item of ignoredEvidence) {
    reasons.push({
      kind: 'IGNORED_NEUTRAL_EVIDENCE',
      bundle: item.bundle,
      signalName: item.signalName,
      participantId,
    });
  }

  if (uncertainty >= UNCERTAINTY_INCREASE_THRESHOLD) {
    reasons.push({
      kind: 'WIDE_CREDIBLE_INTERVAL',
      bundle: 'claim',
      signalName: 'credible_interval_width',
      participantId,
    });
  }

  return reasons;
}

/**
 * Enriches an explanation summary with contradiction metrics produced by
 * `CandidateConfidenceEngine`. Returns `null` when no metrics are supplied.
 */
export function buildContradictionReasoningSummary(
  input: BuildContradictionReasoningInput,
): ContradictionReasoningSummary | null {
  if (input.contradictionMetrics === undefined) {
    return null;
  }

  const max = input.maxStrongest ?? DEFAULT_MAX_STRONGEST;
  const participantMetrics = selectParticipantMetrics(
    input.contradictionMetrics,
    input.topParticipantId,
  );

  if (participantMetrics === null) {
    return null;
  }

  const participantId = participantMetrics.participantId;
  const agreements = strongestAgreements(input.contributingSignals, max);
  const contradictions = participantMetrics.contradictions.slice(0, max);
  const ignoredEvidence = ignoredFromClassification(input.classification, participantId);

  return {
    participantId,
    strongestAgreements: agreements,
    strongestContradictions: contradictions,
    ignoredEvidence,
    evidenceConsistency: participantMetrics.consistencyScore,
    agreementScore: participantMetrics.agreementScore,
    contradictionScore: participantMetrics.contradictionScore,
    consistencyScore: participantMetrics.consistencyScore,
    reasonsConfidenceIncreased: reasonsConfidenceIncreased(agreements, participantId),
    reasonsConfidenceDecreased: reasonsConfidenceDecreased(contradictions, participantId),
    reasonsUncertaintyIncreased: reasonsUncertaintyIncreased(
      input.missingEvidence,
      ignoredEvidence,
      input.uncertainty,
      participantId,
    ),
  };
}
