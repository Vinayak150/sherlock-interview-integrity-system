import type { LifecycleState } from '../statemachine/index.js';
import type { ContradictionReasoningSummary } from '../explanation/contradictionReasoning.js';
import type { CrossModalReasoningSummary } from '../explanation/crossModalReasoning.js';
import type {
  ContributingSignal,
  EvidenceRecommendation,
  MissingEvidenceItem,
  StructuredEvidenceSummary,
} from '../explanation/types.js';

export interface RankedCandidateInput {
  readonly participantId: string;
  readonly probability: number;
  readonly confidence: number;
  readonly identificationState: 'IDENTIFIED' | 'UNKNOWN';
}

/**
 * Structured-only input for LLM explanation generation. Never carries raw
 * media, transcripts, or free-form instructions — only facts already
 * computed by the deterministic Explanation Engine path.
 */
export interface LLMExplanationRequest {
  readonly sessionId: string;
  readonly lifecycleState: LifecycleState;
  readonly evaluatedAt: Date;
  readonly candidateRanking: readonly RankedCandidateInput[];
  readonly contradictionReasoning: ContradictionReasoningSummary | null;
  readonly crossModalReasoning: CrossModalReasoningSummary | null;
  readonly structuredSummary: StructuredEvidenceSummary;
  readonly confidence: number;
  readonly uncertainty: number;
  readonly recommendation: EvidenceRecommendation;
  readonly topContributingSignals: readonly ContributingSignal[];
  readonly contradictoryEvidence: readonly ContributingSignal[];
  readonly missingEvidence: readonly MissingEvidenceItem[];
}

/** Provider-agnostic structured explanation output. */
export interface LLMExplanationResponse {
  readonly executiveSummary: string;
  readonly reviewerExplanation: string;
  readonly recommendationSummary: string;
  readonly reasoning: readonly string[];
  readonly generatedAt: string;
  readonly provider: string;
}

export type LLMHealthStatus = 'healthy' | 'unhealthy';

export interface LLMHealthCheckResponse {
  readonly status: LLMHealthStatus;
  readonly provider: string;
  readonly version: string;
  readonly supportsStructuredOutput: boolean;
}

export type LLMProviderKind = 'stub';

export interface LLMProviderFactoryOptions {
  readonly provider?: LLMProviderKind;
}
