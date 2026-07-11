/**
 * Public surface of the Evidence Report Engine module (RFC §8; Plan §9
 * repository structure `orchestrator/explanation/`, Milestone M6).
 *
 * This module owns: deterministic Evidence Report generation, explanation
 * composition, evidence ordering, report formatting, and the audit
 * artifact the report itself represents. It never makes a decision (no
 * alerting, no recommendation, no abstention logic) — that is
 * `decision/`'s job (M5) — and has no import from it.
 */
export type { CrossModalReasoningSummary } from './crossModalReasoning.js';
export { buildCrossModalReasoningSummary } from './crossModalReasoning.js';
export type {
  ContradictionReasoningSummary,
  IgnoredEvidenceItem,
  StructuredConfidenceReason,
  ConfidenceReasonKind,
} from './contradictionReasoning.js';
export { buildContradictionReasoningSummary } from './contradictionReasoning.js';
export type {
  ContributingSignal,
  EvidenceRecommendation,
  EvidenceReport,
  MissingEvidenceItem,
  StructuredEvidenceSummary,
} from './types.js';
export { buildStructuredEvidenceSummary, deriveEvidenceRecommendation, emptyStructuredEvidenceSummary } from './evidenceSummary.js';

export type { BuildReportInput, ExplanationEngineOptions } from './explanationEngine.js';
export { ExplanationEngine } from './explanationEngine.js';

/**
 * M12: the constrained LLM narrative layer, additive on top of M6's
 * structured report. Deliberately separate from `ExplanationEngine`
 * itself (M6, untouched) — narrative generation is optional and
 * degradable; the structured report is not.
 */
export type { LLMProviderFactoryOptions, LLMProviderKind } from '../llm/index.js';
export {
  LLMProviderFactory,
  StubLLMProvider as StructuredStubLLMProvider,
  buildLLMExplanationRequest,
} from '../llm/index.js';
export type {
  LLMExplanationRequest,
  LLMExplanationResponse,
  LLMHealthCheckResponse,
  LLMProvider,
  RankedCandidateInput,
} from '../llm/index.js';

export type { LlmProvider } from './llmProvider.js';
export { LlmProviderUnavailableError, StubLlmProvider } from './llmProvider.js';

export { buildNarrativePrompt } from './narrativePrompt.js';

export type { NarrativeValidationResult } from './narrativeValidator.js';
export { validateNarrative } from './narrativeValidator.js';

export type { LlmNarrativeAdapterOptions } from './llmNarrativeAdapter.js';
export { LlmNarrativeAdapter } from './llmNarrativeAdapter.js';
