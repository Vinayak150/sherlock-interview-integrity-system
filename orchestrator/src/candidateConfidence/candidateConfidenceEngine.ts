import type { EvidenceEvent, NewEvidenceEvent } from '@sherlock/contracts';

import type { ClaimBundleAdapter, ObservedIdentityClaim } from '../bundles/claim/claimBundleAdapter.js';
import { DEFAULT_ABSTENTION_PROBABILITY_THRESHOLD } from '../decision/decisionEngine.js';
import {
  UNSCOPED_PARTICIPANT_ID,
  buildParticipantClassification,
  buildSessionEvidenceClassification,
} from '../evidenceClassification/index.js';
import type { FusionEngine, FusionPosterior } from '../fusion/index.js';
import { topEvidenceContributors } from './contributors.js';
import {
  computeSessionContradictionMetrics,
  indexEvidenceEvents,
} from './contradictionMetrics.js';
import type { SessionContradictionMetrics } from './contradictionMetrics.js';
import {
  computeSessionCrossModalMetrics,
  crossModalSelectionScore,
} from './crossModalConsistency.js';
import type { SessionCrossModalMetrics } from './crossModalConsistency.js';
import type { ParticipantCrossModalMetrics } from './crossModalConsistency.js';
import type {
  CandidateConfidenceEvaluation,
  CandidateConfidenceTable,
  CandidateIdentificationState,
  RankedCandidate,
} from './types.js';
import type { SessionEvidenceClassification } from '../evidenceClassification/index.js';

export interface CandidateConfidenceEngineOptions {
  /** Matches Decision Engine abstention — below this, a participant is `UNKNOWN`. */
  readonly abstentionProbabilityThreshold?: number;
  /** When true (default), a single-participant session uses the full persisted ledger for bit-exact backward compatibility. */
  readonly useFullLedgerForSingleParticipant?: boolean;
}

interface SessionCandidateState {
  readonly participantIds: Set<string>;
  observedClaim: ObservedIdentityClaim | null;
}

function asPersistedEvents(
  events: readonly NewEvidenceEvent[],
  evaluatedAt: Date,
): EvidenceEvent[] {
  return events.map((event, index) => ({
    ...event,
    id: `synthetic-${event.bundle}-${event.signalName}-${index}`,
    recordedAt: evaluatedAt,
  }));
}

function intervalWidth(posterior: FusionPosterior): number {
  return posterior.credibleInterval.upper - posterior.credibleInterval.lower;
}

function identificationState(
  probability: number,
  threshold: number,
): CandidateIdentificationState {
  return probability >= threshold ? 'IDENTIFIED' : 'UNKNOWN';
}

function toRankedCandidate(
  participantId: string,
  posterior: FusionPosterior,
  contributors: ReturnType<typeof topEvidenceContributors>,
  threshold: number,
  crossModal: ParticipantCrossModalMetrics | null = null,
): RankedCandidate {
  return {
    participantId,
    probability: posterior.probability,
    confidence: posterior.probability,
    uncertainty: intervalWidth(posterior),
    lastUpdated: posterior.evaluatedAt,
    identificationState: identificationState(posterior.probability, threshold),
    topEvidenceContributors: contributors,
    posterior,
    crossModal,
  };
}

/**
 * Maintains an internal, per-session ranked candidate table and selects the
 * top participant's posterior for the existing lifecycle + decision
 * pipeline. Public APIs, persistence, lifecycle FSM, and the Explanation
 * Engine are unchanged — this module only improves how the orchestrator
 * estimates which filed candidate best explains the observed evidence.
 */
export class CandidateConfidenceEngine {
  private readonly abstentionThreshold: number;
  private readonly useFullLedgerForSingleParticipant: boolean;
  private readonly sessionState = new Map<string, SessionCandidateState>();

  constructor(
    private readonly fusionEngine: FusionEngine,
    private readonly claimAdapter: ClaimBundleAdapter,
    options: CandidateConfidenceEngineOptions = {},
  ) {
    this.abstentionThreshold =
      options.abstentionProbabilityThreshold ?? DEFAULT_ABSTENTION_PROBABILITY_THRESHOLD;
    this.useFullLedgerForSingleParticipant = options.useFullLedgerForSingleParticipant ?? true;
  }

  /**
   * Records the latest pre-call identity observation and expands the
   * participant pool. Called on claim+metadata ingestion only.
   */
  recordClaimObservation(
    sessionId: string,
    observedClaim: ObservedIdentityClaim,
    additionalParticipantIds: readonly string[] = [],
  ): void {
    const state = this.sessionState.get(sessionId) ?? {
      participantIds: new Set<string>(),
      observedClaim: null,
    };

    state.participantIds.add(observedClaim.candidateId);
    for (const participantId of additionalParticipantIds) {
      state.participantIds.add(participantId);
    }
    state.observedClaim = observedClaim;
    this.sessionState.set(sessionId, state);
  }

  /**
   * Recomputes the ranked table and returns the posterior the downstream
   * pipeline should use (top-ranked participant, or session-wide fusion
   * when no participant pool exists yet).
   */
  async evaluate(
    sessionId: string,
    events: readonly EvidenceEvent[],
    evaluatedAt: Date = new Date(),
  ): Promise<CandidateConfidenceEvaluation> {
    const sessionEvents = events.filter((event) => event.sessionId === sessionId);
    const state = this.sessionState.get(sessionId);
    const participantIds = state === undefined ? [] : [...state.participantIds];

    if (participantIds.length === 0) {
      const posterior = this.fusionEngine.computePosterior(sessionId, sessionEvents, evaluatedAt);
      const classification = buildSessionEvidenceClassification(sessionId, evaluatedAt, [
        buildParticipantClassification(UNSCOPED_PARTICIPANT_ID, sessionEvents),
      ]);
      return this.finalizeEvaluation(
        posterior,
        emptyTable(sessionId, evaluatedAt),
        classification,
        indexEvidenceEvents(sessionEvents),
      );
    }

    if (participantIds.length === 1 && this.useFullLedgerForSingleParticipant) {
      const participantId = participantIds[0]!;
      const posterior = this.fusionEngine.computePosterior(sessionId, sessionEvents, evaluatedAt);
      const classification = buildSessionEvidenceClassification(sessionId, evaluatedAt, [
        buildParticipantClassification(participantId, sessionEvents),
      ]);
      const ranked = toRankedCandidate(
        participantId,
        posterior,
        topEvidenceContributors(sessionEvents, evaluatedAt, { participantId }),
        this.abstentionThreshold,
      );
      return this.finalizeEvaluation(
        posterior,
        buildTable(sessionId, evaluatedAt, [ranked]),
        classification,
        indexEvidenceEvents(sessionEvents),
      );
    }

    const observedClaim = state?.observedClaim;
    if (observedClaim === null || observedClaim === undefined) {
      const posterior = this.fusionEngine.computePosterior(sessionId, sessionEvents, evaluatedAt);
      const classification = buildSessionEvidenceClassification(sessionId, evaluatedAt, [
        buildParticipantClassification(UNSCOPED_PARTICIPANT_ID, sessionEvents),
      ]);
      return this.finalizeEvaluation(
        posterior,
        emptyTable(sessionId, evaluatedAt),
        classification,
        indexEvidenceEvents(sessionEvents),
      );
    }

    const nonClaimEvents = sessionEvents.filter((event) => event.bundle !== 'claim');
    const rankedCandidates: RankedCandidate[] = [];
    const participantClassifications = [];
    const eventsById = indexEvidenceEvents(nonClaimEvents);

    for (const participantId of participantIds) {
      const claimEvents = asPersistedEvents(
        await this.claimAdapter.buildEvidenceEvents(
          sessionId,
          { ...observedClaim, candidateId: participantId },
          evaluatedAt,
        ),
        evaluatedAt,
      );
      for (const event of claimEvents) {
        eventsById.set(event.id, event);
      }
      const hypothesisEvents = [...nonClaimEvents, ...claimEvents];
      participantClassifications.push(
        buildParticipantClassification(participantId, hypothesisEvents),
      );
      const posterior = this.fusionEngine.computePosterior(
        sessionId,
        hypothesisEvents,
        evaluatedAt,
      );
      rankedCandidates.push(
        toRankedCandidate(
          participantId,
          posterior,
          topEvidenceContributors(hypothesisEvents, evaluatedAt, { participantId }),
          this.abstentionThreshold,
        ),
      );
    }

    rankedCandidates.sort((a, b) => b.probability - a.probability);
    const classification = buildSessionEvidenceClassification(
      sessionId,
      evaluatedAt,
      participantClassifications,
    );
    const eventsByIdFull = indexEvidenceEvents([...eventsById.values()]);

    return this.finalizeEvaluation(
      rankedCandidates[0]!.posterior,
      buildTable(sessionId, evaluatedAt, rankedCandidates),
      classification,
      eventsByIdFull,
    );
  }

  private applyCrossModalRanking(
    table: CandidateConfidenceTable,
    crossModalMetrics: SessionCrossModalMetrics,
  ): CandidateConfidenceTable {
    if (table.rankedCandidates.length <= 1) {
      return table;
    }

    const crossModalByParticipant = new Map(
      crossModalMetrics.byParticipant.map((row) => [row.participantId, row]),
    );

    const reranked = [...table.rankedCandidates]
      .map((candidate) => {
        const crossModal = crossModalByParticipant.get(candidate.participantId) ?? null;
        return {
          ...candidate,
          crossModal,
        };
      })
      .sort((a, b) => {
        const scoreA = crossModalSelectionScore(
          a.probability,
          a.crossModal ?? defaultCrossModalMetrics(a.participantId),
        );
        const scoreB = crossModalSelectionScore(
          b.probability,
          b.crossModal ?? defaultCrossModalMetrics(b.participantId),
        );
        return scoreB - scoreA;
      });

    return {
      ...table,
      rankedCandidates: reranked,
      topParticipantId: reranked[0]?.participantId ?? null,
    };
  }

  private finalizeEvaluation(
    selectedPosterior: FusionPosterior,
    table: CandidateConfidenceTable,
    classification: SessionEvidenceClassification,
    eventsById: ReadonlyMap<string, EvidenceEvent>,
  ): CandidateConfidenceEvaluation {
    const contradictionMetrics = computeSessionContradictionMetrics(classification, eventsById);
    const crossModalMetrics = computeSessionCrossModalMetrics(
      classification,
      eventsById,
      contradictionMetrics,
    );
    const influencedTable = this.applyCrossModalRanking(
      attachCrossModalToTable(table, crossModalMetrics),
      crossModalMetrics,
    );
    const topCandidate = influencedTable.rankedCandidates[0];
    const influencedPosterior = topCandidate?.posterior ?? selectedPosterior;

    this.rememberClassification(classification);
    this.rememberContradictionMetrics(contradictionMetrics);
    this.rememberCrossModalMetrics(crossModalMetrics);
    return {
      selectedPosterior: influencedPosterior,
      table: influencedTable,
      classification,
      contradictionMetrics,
      crossModalMetrics,
    };
  }

  /** Test/diagnostic hook — not part of public HTTP APIs. */
  getCrossModalMetrics(sessionId: string): SessionCrossModalMetrics | null {
    return this.lastCrossModalMetricsBySession.get(sessionId) ?? null;
  }

  private readonly lastCrossModalMetricsBySession = new Map<string, SessionCrossModalMetrics>();

  rememberCrossModalMetrics(metrics: SessionCrossModalMetrics): void {
    this.lastCrossModalMetricsBySession.set(metrics.sessionId, metrics);
  }

  /** Test/diagnostic hook — not part of public HTTP APIs. */
  getContradictionMetrics(sessionId: string): SessionContradictionMetrics | null {
    return this.lastContradictionMetricsBySession.get(sessionId) ?? null;
  }

  private readonly lastContradictionMetricsBySession = new Map<string, SessionContradictionMetrics>();

  rememberContradictionMetrics(metrics: SessionContradictionMetrics): void {
    this.lastContradictionMetricsBySession.set(metrics.sessionId, metrics);
  }

  /** Test/diagnostic hook — not part of public HTTP APIs. */
  getClassification(sessionId: string) {
    return this.lastClassificationBySession.get(sessionId) ?? null;
  }

  private readonly lastClassificationBySession = new Map<string, SessionEvidenceClassification>();

  rememberClassification(classification: SessionEvidenceClassification): void {
    this.lastClassificationBySession.set(classification.sessionId, classification);
  }

  /** Test/diagnostic hook — not part of public HTTP APIs. */
  getTable(sessionId: string): CandidateConfidenceTable | null {
    return this.lastTableBySession.get(sessionId) ?? null;
  }

  private readonly lastTableBySession = new Map<string, CandidateConfidenceTable>();

  /** Persists the latest table for internal inspection; called after evaluate in orchestration. */
  rememberTable(table: CandidateConfidenceTable): void {
    this.lastTableBySession.set(table.sessionId, table);
  }
}

function defaultCrossModalMetrics(participantId: string): ParticipantCrossModalMetrics {
  return {
    participantId,
    modalities: [],
    crossModalConsistency: 1,
    crossModalConfidence: 0,
    crossModalDisagreement: 0,
  };
}

function attachCrossModalToTable(
  table: CandidateConfidenceTable,
  crossModalMetrics: SessionCrossModalMetrics,
): CandidateConfidenceTable {
  const crossModalByParticipant = new Map(
    crossModalMetrics.byParticipant.map((row) => [row.participantId, row]),
  );

  return {
    ...table,
    rankedCandidates: table.rankedCandidates.map((candidate) => ({
      ...candidate,
      crossModal: crossModalByParticipant.get(candidate.participantId) ?? null,
    })),
  };
}

function emptyTable(sessionId: string, evaluatedAt: Date): CandidateConfidenceTable {
  return {
    sessionId,
    evaluatedAt,
    rankedCandidates: [],
    topParticipantId: null,
  };
}

function buildTable(
  sessionId: string,
  evaluatedAt: Date,
  rankedCandidates: readonly RankedCandidate[],
): CandidateConfidenceTable {
  return {
    sessionId,
    evaluatedAt,
    rankedCandidates,
    topParticipantId: rankedCandidates[0]?.participantId ?? null,
  };
}
