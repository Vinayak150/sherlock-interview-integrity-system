import type { EvidenceEvent } from '@sherlock/contracts';

import {
  DEFAULT_HALF_LIFE_MS,
  decayWeight,
  signalLogLikelihoodRatio,
} from '../fusion/index.js';
import { classifyEvidenceEvent, UNSCOPED_PARTICIPANT_ID } from '../evidenceClassification/index.js';
import type { FusionPosterior } from '../fusion/index.js';
import type { LifecycleState } from '../statemachine/index.js';
import type { ContributingSignal, EvidenceReport, MissingEvidenceItem } from './types.js';
import { buildContradictionReasoningSummary } from './contradictionReasoning.js';
import { buildCrossModalReasoningSummary } from './crossModalReasoning.js';
import { buildStructuredEvidenceSummary } from './evidenceSummary.js';
import type { SessionContradictionMetrics } from '../candidateConfidence/contradictionMetrics.js';
import type { SessionCrossModalMetrics } from '../candidateConfidence/crossModalConsistency.js';
import type { SessionEvidenceClassification } from '../evidenceClassification/index.js';

import type { LLMProvider } from '../llm/index.js';
import { buildLLMExplanationRequest } from '../llm/requestBuilder.js';
import type { LLMExplanationRequest, LLMExplanationResponse, RankedCandidateInput } from '../llm/types.js';

/** A generous but bounded cap, so a long session's full evidence ledger never produces an unbounded report by default. Overridable per call site (e.g. a compliance audit export). */
const DEFAULT_MAX_TOP_SIGNALS = 20;

export interface ExplanationEngineOptions {
  /** Must match the half-life the Fusion Engine (M3) used to produce `posterior`, so ranked contributions stay consistent with that posterior's own math. Defaults to the same `DEFAULT_HALF_LIFE_MS` the Fusion Engine defaults to. */
  readonly halfLifeMs?: number;
  readonly maxTopSignals?: number;
  /** Optional LLM provider for structured explanation generation — never required for deterministic reports. */
  readonly llmProvider?: LLMProvider;
}

export interface BuildReportInput {
  readonly sessionId: string;
  readonly lifecycleState: LifecycleState;
  readonly posterior: FusionPosterior;
  readonly events: readonly EvidenceEvent[];
  readonly generatedAt?: Date;
  /** Precomputed contradiction metrics from `CandidateConfidenceEngine` — not recalculated here. */
  readonly contradictionMetrics?: SessionContradictionMetrics;
  readonly classification?: SessionEvidenceClassification;
  readonly topParticipantId?: string | null;
  readonly crossModalMetrics?: SessionCrossModalMetrics;
}

function assertPositive(name: string, value: number): void {
  if (!(value > 0)) {
    throw new RangeError(`${name} must be positive, received ${value}`);
  }
}

/**
 * The Evidence Report Engine (RFC §8, the non-LLM half of ADR-2; Plan M6).
 *
 * Builds the deterministic structured `EvidenceReport` — "structured
 * facts (signal names, values, contributions, timestamps) generated
 * deterministically by the fusion engine and state manager ... guaranteed
 * accurate by construction, never touched by a model that could
 * hallucinate them" (RFC §8). The constrained-LLM prose layer described in
 * the same RFC section is Plan M12's job, not built here.
 *
 * This engine makes no decisions: it never decides whether to alert, who
 * should review, or what a reviewer should do next — it only explains the
 * evidence behind whatever lifecycle state and posterior it is handed.
 * It has no dependency on, and no import from, `decision/`.
 */
export class ExplanationEngine {
  private readonly halfLifeMs: number;
  private readonly maxTopSignals: number;
  private readonly llmProvider: LLMProvider | undefined;

  constructor(options: ExplanationEngineOptions = {}) {
    this.halfLifeMs = options.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;
    this.maxTopSignals = options.maxTopSignals ?? DEFAULT_MAX_TOP_SIGNALS;
    this.llmProvider = options.llmProvider;
    assertPositive('halfLifeMs', this.halfLifeMs);
    assertPositive('maxTopSignals', this.maxTopSignals);
  }

  /**
   * Optional structured LLM explanation layer. Returns `null` when no
   * provider is configured or when the provider is unavailable — never
   * affects `buildReport()` output.
   */
  async generateExplanation(
    report: EvidenceReport,
    candidateRanking: readonly RankedCandidateInput[] = [],
  ): Promise<LLMExplanationResponse | null> {
    if (this.llmProvider === undefined) {
      return null;
    }

    const request = buildLLMExplanationRequest(report, candidateRanking);
    try {
      return await this.llmProvider.generateExplanation(request);
    } catch {
      return null;
    }
  }

  /** Builds a provider request without invoking the LLM — useful for tests and provider adapters. */
  buildLLMExplanationRequest(
    report: EvidenceReport,
    candidateRanking: readonly RankedCandidateInput[] = [],
  ): LLMExplanationRequest {
    return buildLLMExplanationRequest(report, candidateRanking);
  }

  /**
   * Builds the report from `input.events` — the caller is responsible for
   * supplying the session's evidence (typically the same immutable
   * evidence reference the Decision Engine (M5) captured, or a fresh read
   * from the Evidence Store, M1). Events for a *different* `sessionId` are
   * filtered out defensively rather than trusted blindly, matching the
   * Fusion Engine's (M3) own defensive posture.
   */
  buildReport(input: BuildReportInput): EvidenceReport {
    const generatedAt = input.generatedAt ?? new Date();
    const sessionEvents = input.events.filter((event) => event.sessionId === input.sessionId);

    const contributingSignals: ContributingSignal[] = [];
    const missingEvidence: MissingEvidenceItem[] = [];

    for (const event of sessionEvents) {
      if (
        event.healthStatus === 'SERVICE_UNAVAILABLE' ||
        event.healthStatus === 'NO_SIGNAL_DETECTED'
      ) {
        missingEvidence.push({
          bundle: event.bundle,
          signalName: event.signalName,
          healthStatus: event.healthStatus,
          occurredAt: event.occurredAt,
        });
        continue;
      }

      const outcome = classifyEvidenceEvent(event, UNSCOPED_PARTICIPANT_ID).classification;
      const rawLogLR = signalLogLikelihoodRatio(event);
      const decayedLogLikelihoodRatio =
        rawLogLR * decayWeight(event.occurredAt, generatedAt, this.halfLifeMs);
      if (decayedLogLikelihoodRatio === 0) continue; // NEUTRAL / unregistered -- not "contributing"

      contributingSignals.push({
        bundle: event.bundle,
        signalName: event.signalName,
        outcome,
        decayedLogLikelihoodRatio,
        occurredAt: event.occurredAt,
      });
    }

    const rankedSignals = [...contributingSignals].sort(
      (a, b) => Math.abs(b.decayedLogLikelihoodRatio) - Math.abs(a.decayedLogLikelihoodRatio),
    );

    const contradictoryEvidence = rankedSignals.filter((signal) => signal.outcome === 'CONTRADICTS');

    const uncertainty =
      input.posterior.credibleInterval.upper - input.posterior.credibleInterval.lower;

    const contradictionReasoning =
      input.contradictionMetrics === undefined
        ? null
        : buildContradictionReasoningSummary({
            contradictionMetrics: input.contradictionMetrics,
            ...(input.classification === undefined
              ? {}
              : { classification: input.classification }),
            contributingSignals,
            missingEvidence,
            uncertainty,
            ...(input.topParticipantId === undefined
              ? {}
              : { topParticipantId: input.topParticipantId }),
            maxStrongest: this.maxTopSignals,
          });

    const crossModalReasoning =
      input.crossModalMetrics === undefined
        ? null
        : buildCrossModalReasoningSummary({
            crossModalMetrics: input.crossModalMetrics,
            ...(input.topParticipantId === undefined
              ? {}
              : { topParticipantId: input.topParticipantId }),
          });

    const summary = {
      ...buildStructuredEvidenceSummary(
        input.lifecycleState,
        input.posterior,
        contributingSignals,
        contradictoryEvidence,
        missingEvidence,
        this.maxTopSignals,
      ),
      contradictionReasoning,
      crossModalReasoning,
    };

    return {
      sessionId: input.sessionId,
      generatedAt,
      lifecycleState: input.lifecycleState,
      probability: input.posterior.probability,
      topContributingSignals: rankedSignals.slice(0, this.maxTopSignals),
      contradictoryEvidence,
      missingEvidence,
      alternativeHypotheses: [],
      summary,
    };
  }
}
