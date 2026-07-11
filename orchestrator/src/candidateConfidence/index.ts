export { CandidateConfidenceEngine } from './candidateConfidenceEngine.js';
export type { CandidateConfidenceEngineOptions } from './candidateConfidenceEngine.js';
export { topEvidenceContributors } from './contributors.js';
export {
  computeSessionCrossModalMetrics,
  crossModalSelectionScore,
} from './crossModalConsistency.js';
export type {
  CrossModalModality,
  ModalityIdentityAssessment,
  ModalityIdentityStance,
  ParticipantCrossModalMetrics,
  SessionCrossModalMetrics,
} from './crossModalConsistency.js';
export {
  computeSessionContradictionMetrics,
  indexEvidenceEvents,
} from './contradictionMetrics.js';
export type {
  ContradictionRecord,
  ContradictionSeverity,
  ParticipantContradictionMetrics,
  SessionContradictionMetrics,
} from './contradictionMetrics.js';
export type {
  CandidateConfidenceEvaluation,
  CandidateConfidenceTable,
  CandidateIdentificationState,
  EvidenceContributor,
  RankedCandidate,
} from './types.js';
