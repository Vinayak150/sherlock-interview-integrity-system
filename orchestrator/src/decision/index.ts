/**
 * Public surface of the Decision Engine module (RFC §10; Plan §9
 * repository structure `orchestrator/decision/`, Milestone M5).
 *
 * This module owns: the Decision Engine, alert generation, abstention
 * logic, reviewer recommendation, the structured `Decision` object, and
 * immutable evidence references. It never generates a report — that is
 * `explanation/`'s job (M6) — and has no import from it.
 */
export type {
  Alert,
  AlertSeverity,
  Decision,
  ElicitationTrigger,
  EvidenceReference,
  ReviewerRecommendation,
} from './types.js';

export type { DecisionEngineOptions, DecisionInput, DecisionOutcome } from './decisionEngine.js';
export {
  DEFAULT_ABSTENTION_PROBABILITY_THRESHOLD,
  DEFAULT_AMBIGUOUS_MAX_INTERVAL_WIDTH,
  DEFAULT_AMBIGUOUS_PROBABILITY_BAND,
  DecisionEngine,
  decideForSession,
} from './decisionEngine.js';
