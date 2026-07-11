import type { FusionPosterior } from '../fusion/index.js';
import type { LifecycleState } from '../statemachine/index.js';
import type {
  ContributingSignal,
  EvidenceRecommendation,
  MissingEvidenceItem,
  StructuredEvidenceSummary,
} from './types.js';

/** RFC §10 abstention threshold — kept in sync with `decision/decisionEngine.ts` by value, not import. */
const ABSTENTION_PROBABILITY_THRESHOLD = 0.55;
const AMBIGUOUS_PROBABILITY_BAND = 0.05;
const AMBIGUOUS_MAX_INTERVAL_WIDTH = 0.3;

const DEFAULT_MAX_STRONGEST_SUPPORTING = 3;

function isConfidentlyAmbiguous(posterior: FusionPosterior): boolean {
  const band = AMBIGUOUS_PROBABILITY_BAND;
  const maxWidth = AMBIGUOUS_MAX_INTERVAL_WIDTH;
  const nearMidpoint = Math.abs(posterior.probability - 0.5) <= band;
  const tightInterval =
    posterior.credibleInterval.upper - posterior.credibleInterval.lower <= maxWidth;
  return nearMidpoint && tightInterval;
}

export function deriveEvidenceRecommendation(
  lifecycleState: LifecycleState,
  posterior: FusionPosterior,
): EvidenceRecommendation {
  if (lifecycleState === 'DISQUALIFIED') {
    return 'MANDATORY_REVIEW';
  }
  if (lifecycleState === 'LOST_CONFIDENCE') {
    return 'MONITOR';
  }
  if (lifecycleState === 'UNKNOWN' && posterior.probability < ABSTENTION_PROBABILITY_THRESHOLD) {
    return 'DEFER_TO_ORDINARY_JUDGMENT';
  }
  if (isConfidentlyAmbiguous(posterior)) {
    return 'ADJUDICATE';
  }
  return 'NONE';
}

export function buildStructuredEvidenceSummary(
  lifecycleState: LifecycleState,
  posterior: FusionPosterior,
  contributingSignals: readonly ContributingSignal[],
  contradictoryEvidence: readonly ContributingSignal[],
  missingEvidence: readonly MissingEvidenceItem[],
  maxStrongestSupporting: number = DEFAULT_MAX_STRONGEST_SUPPORTING,
): StructuredEvidenceSummary {
  const strongestSupportingEvidence = [...contributingSignals]
    .filter((signal) => signal.outcome === 'SUPPORTS')
    .sort((a, b) => b.decayedLogLikelihoodRatio - a.decayedLogLikelihoodRatio)
    .slice(0, maxStrongestSupporting);

  return {
    strongestSupportingEvidence,
    conflictingEvidence: contradictoryEvidence,
    missingEvidence,
    confidence: posterior.probability,
    rawConfidence: posterior.rawProbability ?? posterior.probability,
    uncertainty: posterior.credibleInterval.upper - posterior.credibleInterval.lower,
    recommendation: deriveEvidenceRecommendation(lifecycleState, posterior),
    contradictionReasoning: null,
    crossModalReasoning: null,
  };
}

/** Minimal summary for tests and narrative fixtures that only override legacy fields. */
export function emptyStructuredEvidenceSummary(
  overrides: Partial<StructuredEvidenceSummary> = {},
): StructuredEvidenceSummary {
  return {
    strongestSupportingEvidence: [],
    conflictingEvidence: [],
    missingEvidence: [],
    confidence: 0,
    rawConfidence: 0,
    uncertainty: 1,
    recommendation: 'NONE',
    contradictionReasoning: null,
    crossModalReasoning: null,
    ...overrides,
  };
}
