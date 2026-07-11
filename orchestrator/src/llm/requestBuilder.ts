import type { EvidenceReport } from '../explanation/types.js';
import type { LLMExplanationRequest, RankedCandidateInput } from './types.js';

export function buildLLMExplanationRequest(
  report: EvidenceReport,
  candidateRanking: readonly RankedCandidateInput[] = [],
): LLMExplanationRequest {
  return {
    sessionId: report.sessionId,
    lifecycleState: report.lifecycleState,
    evaluatedAt: report.generatedAt,
    candidateRanking,
    contradictionReasoning: report.summary.contradictionReasoning,
    crossModalReasoning: report.summary.crossModalReasoning,
    structuredSummary: report.summary,
    confidence: report.summary.confidence,
    uncertainty: report.summary.uncertainty,
    recommendation: report.summary.recommendation,
    topContributingSignals: report.topContributingSignals,
    contradictoryEvidence: report.contradictoryEvidence,
    missingEvidence: report.missingEvidence,
  };
}
