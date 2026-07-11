import type { NewEvidenceEvent } from '@sherlock/contracts';

import type {
  AudioBundleAdapter,
  ClaimBundleAdapter,
  DeviceBundleAdapter,
  DeviceBundleInput,
  ElicitationBundleAdapter,
  ElicitationBundleInput,
  LinguisticBundleAdapter,
  LinguisticBundleInput,
  MetadataBundleAdapter,
  ObservedIdentityClaim,
  SessionJoinMetadata,
  VisualBundleAdapter,
} from '../bundles/index.js';
import { extractContradictionSignal } from '../bundles/index.js';
import type { Decision, DecisionEngine } from '../decision/index.js';
import type {
  EvidenceReport,
  ExplanationEngine,
  LlmNarrativeAdapter,
} from '../explanation/index.js';
import { CandidateConfidenceEngine } from '../candidateConfidence/index.js';
import type { ConfidenceCalibrator } from '../calibration/index.js';
import type { AiMetricsRecorder } from '../observability/index.js';
import type { FusionEngine } from '../fusion/index.js';
import type {
  AccommodationDisclosureRepository,
  EvidenceEventRepository,
} from '../persistence/index.js';
import type { SessionLifecycleStore } from '../routing/index.js';
import type { Appeal, AppealRepository, AuditLogRepository, NewAppeal } from '../security/index.js';
import type {
  ContradictionSignal,
  LifecycleState,
  LifecycleTransitionResult,
} from '../statemachine/index.js';
import type { SessionEventBus } from './sessionEventBus.js';

export interface IngestEvidenceResult {
  readonly decision: Decision;
  readonly report: EvidenceReport | null;
  /** Plan M12. `null` whenever `report` is `null` (nothing to narrate), whenever no `LlmNarrativeAdapter` is configured, or whenever the LLM layer itself degrades (RFC §13) — never a rejected or partially-validated narrative. */
  readonly narrative: string | null;
}

export interface SessionStatus {
  readonly sessionId: string;
  readonly lifecycleState: LifecycleState;
  /** Plan M13's accommodation-disclosure flow (RFC §11, ADR-13). `false` when no `AccommodationDisclosureRepository` is configured. */
  readonly hasAccommodationDisclosure: boolean;
}

/** Plan M13's "`UNKNOWN`-rate aggregate view" (RFC §10 Committee Note). Scoped to this replica's in-memory sessions only — see `LifecycleStateManager.getAllStates`'s own doc comment. */
export interface AggregateStatus {
  readonly totalSessions: number;
  readonly countsByState: Readonly<Record<LifecycleState, number>>;
  readonly unknownRate: number;
}

/**
 * The orchestration seam Plan M8 ("External Interfaces/API Layer") calls
 * for: "must only orchestrate existing services and must not duplicate
 * decision, fusion, or explanation logic." Every method here is a fixed
 * sequence of calls into already-built engines — no fusion math, no
 * lifecycle-transition rule, no abstention/tie-break policy, and no
 * report-ranking logic is implemented in this class. `httpServer.ts` is
 * the only thing that depends on this class for HTTP; this class itself
 * has no HTTP-framework dependency, so it is trivially unit-testable and
 * reusable from a future non-HTTP entrypoint (a CLI, a queue consumer)
 * without change.
 *
 * `visualAdapter`/`audioAdapter` (Plan M9) are optional constructor
 * parameters appended after the original M8 parameter list — every
 * existing call site continues to work unchanged; a deployment without
 * Visual/Audio bundles configured simply cannot call
 * `ingestVisualAudioEvidence`. `ingestClaimAndMetadataEvidence` and
 * `ingestVisualAudioEvidence` share the identical persist -> fuse ->
 * lifecycle -> decide -> explain sequence via the private `runPipeline`
 * helper, so a future bundle family (Device/OS, Linguistic, Elicitation)
 * only needs its own thin `ingestXEvidence` wrapper, never a change to
 * that shared sequence.
 */
export class SessionOrchestrationService {
  /** Serializes concurrent ingestions per session (RFC §9.4 single-owner ordering at the orchestrator layer). */
  private readonly sessionChains = new Map<string, Promise<unknown>>();
  private readonly candidateConfidenceEngine: CandidateConfidenceEngine;

  constructor(
    private readonly claimAdapter: ClaimBundleAdapter,
    private readonly metadataAdapter: MetadataBundleAdapter,
    private readonly evidenceRepository: EvidenceEventRepository,
    fusionEngine: FusionEngine,
    private readonly lifecycleStore: SessionLifecycleStore,
    private readonly decisionEngine: DecisionEngine,
    private readonly explanationEngine: ExplanationEngine,
    private readonly visualAdapter?: VisualBundleAdapter,
    private readonly audioAdapter?: AudioBundleAdapter,
    private readonly deviceAdapter?: DeviceBundleAdapter,
    private readonly linguisticAdapter?: LinguisticBundleAdapter,
    private readonly elicitationAdapter?: ElicitationBundleAdapter,
    private readonly llmNarrativeAdapter?: LlmNarrativeAdapter,
    private readonly accommodationDisclosureRepository?: AccommodationDisclosureRepository,
    private readonly sessionEventBus?: SessionEventBus,
    private readonly auditLogRepository?: AuditLogRepository,
    private readonly appealRepository?: AppealRepository,
    private readonly confidenceCalibrator?: ConfidenceCalibrator,
    private readonly aiMetricsRecorder?: AiMetricsRecorder,
  ) {
    this.candidateConfidenceEngine = new CandidateConfidenceEngine(fusionEngine, claimAdapter);
  }

  /**
   * Ingests one round of Claim + Metadata bundle observations for a
   * session and runs the full pipeline to completion (RFC §9's
   * ledger-authoritative-before-score ordering, honored throughout).
   */
  async ingestClaimAndMetadataEvidence(
    sessionId: string,
    observedClaim: ObservedIdentityClaim,
    joinMetadata: SessionJoinMetadata,
    now: Date = new Date(),
  ): Promise<IngestEvidenceResult> {
    this.candidateConfidenceEngine.recordClaimObservation(
      sessionId,
      observedClaim,
      this.claimAdapter.listKnownCandidateIds(),
    );
    const claimEvents = await this.claimAdapter.buildEvidenceEvents(sessionId, observedClaim, now);
    const metadataEvents = this.metadataAdapter.buildEvidenceEvents(sessionId, joinMetadata, now);

    return this.runPipeline(sessionId, [...claimEvents, ...metadataEvents], now);
  }

  /**
   * Ingests one round of Visual/Audio bundle observations (Plan M9).
   * Either `framePayload` or `audioPayload` may be `null` when that
   * modality was not captured this tick (RFC §7 absence-of-evidence —
   * the Bundle Adapters themselves, not this method, decide what that
   * means for the signal). A flagged change-point in either bundle's
   * stream (RFC §5) is passed through to the Lifecycle FSM as the
   * `ContradictionSignal` `statemachine/lifecycle.ts` (M4) was built to
   * consume — the real producer this milestone supplies.
   */
  async ingestVisualAudioEvidence(
    sessionId: string,
    framePayload: Uint8Array | null,
    audioPayload: Uint8Array | null,
    now: Date = new Date(),
  ): Promise<IngestEvidenceResult> {
    if (this.visualAdapter === undefined && this.audioAdapter === undefined) {
      throw new Error(
        'SessionOrchestrationService was not configured with a Visual or Audio bundle adapter',
      );
    }

    const events: NewEvidenceEvent[] = [];
    if (framePayload !== null && this.visualAdapter !== undefined) {
      events.push(
        ...(await this.visualAdapter.buildEvidenceEvents(sessionId, { framePayload }, now)),
      );
    }
    if (audioPayload !== null && this.audioAdapter !== undefined) {
      events.push(
        ...(await this.audioAdapter.buildEvidenceEvents(sessionId, { audioPayload }, now)),
      );
    }

    return this.runPipeline(sessionId, events, now);
  }

  /**
   * Ingests one round of Device/OS bundle observations (RFC §4-F/§9.5;
   * Plan M10). ADR-16: these signals are weighted near-zero for identity
   * in `fusion/likelihoodRatios.ts` — this method runs the identical
   * shared pipeline as every other ingestion method, but that pipeline's
   * *inputs* already guarantee this bundle cannot meaningfully move the
   * identity score, satisfying "never folded into the identity score" in
   * practice without a second fusion pipeline.
   */
  async ingestDeviceEvidence(
    sessionId: string,
    input: DeviceBundleInput,
    now: Date = new Date(),
  ): Promise<IngestEvidenceResult> {
    if (this.deviceAdapter === undefined) {
      throw new Error(
        'SessionOrchestrationService was not configured with a Device bundle adapter',
      );
    }

    const events = this.deviceAdapter.buildEvidenceEvents(sessionId, input, now);
    return this.runPipeline(sessionId, events, now);
  }

  /**
   * Ingests one round of Linguistic bundle observations (RFC §4-E; Plan
   * M11) — identity-consistency-only biographical claim checks.
   */
  async ingestLinguisticEvidence(
    sessionId: string,
    input: LinguisticBundleInput,
    now: Date = new Date(),
  ): Promise<IngestEvidenceResult> {
    if (this.linguisticAdapter === undefined) {
      throw new Error(
        'SessionOrchestrationService was not configured with a Linguistic bundle adapter',
      );
    }

    const events = this.linguisticAdapter.buildEvidenceEvents(sessionId, input, now);
    return this.runPipeline(sessionId, events, now);
  }

  /**
   * Ingests one active-elicitation challenge response (RFC §4-G; Plan
   * M11) — the feedback loop for a `Decision.elicitationTrigger`
   * recommendation from a prior tick.
   */
  async ingestElicitationEvidence(
    sessionId: string,
    input: ElicitationBundleInput,
    now: Date = new Date(),
  ): Promise<IngestEvidenceResult> {
    if (this.elicitationAdapter === undefined) {
      throw new Error(
        'SessionOrchestrationService was not configured with an Elicitation bundle adapter',
      );
    }

    const events = this.elicitationAdapter.buildEvidenceEvents(sessionId, input, now);
    return this.runPipeline(sessionId, events, now);
  }

  /**
   * A synchronous read of this replica's currently-held lifecycle state
   * for `sessionId`, plus whether an accommodation disclosure is on file
   * -- never triggers ingestion or recovery on its own.
   *
   * `viewedBy` (RFC §15/Pilot-readiness bar; Plan M16's audit-log
   * coverage) defaults to `'unknown'` so every pre-M16 call site
   * continues to work unchanged; a real deployment's API layer should
   * always pass the actual reviewer identity once one exists (this
   * codebase has no authentication system -- see
   * `AuditLogRepository`'s own stated limitation).
   */
  async getSessionStatus(sessionId: string, viewedBy = 'unknown'): Promise<SessionStatus> {
    const disclosure =
      this.accommodationDisclosureRepository === undefined
        ? null
        : await this.accommodationDisclosureRepository.get(sessionId);

    if (this.auditLogRepository !== undefined) {
      await this.auditLogRepository.record({ sessionId, viewedBy, reason: 'session status view' });
    }

    return {
      sessionId,
      lifecycleState: this.lifecycleStore.getState(sessionId),
      hasAccommodationDisclosure: disclosure !== null,
    };
  }

  /**
   * The only way a session leaves `DISQUALIFIED` (ADR-3; Plan M13's
   * `HumanOverrideAction` round-trip). Thin orchestration only: the
   * invariant itself (nothing else can move a `DISQUALIFIED` session) is
   * enforced by `LifecycleStateManager` (M4), not here.
   */
  async applyHumanOverride(
    sessionId: string,
    nextState: LifecycleState,
    reason?: string,
    now: Date = new Date(),
  ): Promise<LifecycleTransitionResult> {
    return this.lifecycleStore.applyHumanOverride(sessionId, nextState, now, reason);
  }

  /**
   * Records a pre-interview accommodation disclosure (RFC §11, ADR-13;
   * Plan M13). See `AccommodationDisclosureRepository`'s own doc comment
   * for this milestone's stated integration-depth limitation.
   */
  async recordAccommodationDisclosure(sessionId: string, reason: string): Promise<void> {
    if (this.accommodationDisclosureRepository === undefined) {
      throw new Error(
        'SessionOrchestrationService was not configured with an AccommodationDisclosureRepository',
      );
    }
    await this.accommodationDisclosureRepository.record({ sessionId, reason });
  }

  /** Plan M13's `UNKNOWN`-rate aggregate view. */
  getAggregateStatus(): AggregateStatus {
    const states = this.lifecycleStore.getAllStates();
    const countsByState: Record<string, number> = {};
    for (const state of states.values()) {
      countsByState[state] = (countsByState[state] ?? 0) + 1;
    }
    const totalSessions = states.size;
    const unknownRate = totalSessions === 0 ? 0 : (countsByState.UNKNOWN ?? 0) / totalSessions;

    return {
      totalSessions,
      countsByState: countsByState as Record<LifecycleState, number>,
      unknownRate,
    };
  }

  /** Files a candidate appeal against a session's decision (RFC §15/Pilot-readiness bar, "consent + appeal flow"; Plan M16). */
  async fileAppeal(sessionId: string, candidateStatement: string): Promise<Appeal> {
    if (this.appealRepository === undefined) {
      throw new Error('SessionOrchestrationService was not configured with an AppealRepository');
    }
    const appeal: NewAppeal = { sessionId, candidateStatement };
    return this.appealRepository.file(appeal);
  }

  /** Lists every appeal filed for a session. */
  async listAppeals(sessionId: string): Promise<readonly Appeal[]> {
    if (this.appealRepository === undefined) {
      throw new Error('SessionOrchestrationService was not configured with an AppealRepository');
    }
    return this.appealRepository.listBySession(sessionId);
  }

  /** Subscribes to live `Decision` updates for one session (Plan M13's SSE/WebSocket client surface). Returns an unsubscribe function. */
  subscribeToSession(sessionId: string, listener: (decision: Decision) => void): () => void {
    if (this.sessionEventBus === undefined) {
      throw new Error('SessionOrchestrationService was not configured with a SessionEventBus');
    }
    return this.sessionEventBus.subscribe(sessionId, listener);
  }

  private async withSessionLock<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.sessionChains.get(sessionId) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.sessionChains.set(
      sessionId,
      next.catch(() => undefined),
    );
    try {
      return await next;
    } finally {
      if (this.sessionChains.get(sessionId) === next) {
        this.sessionChains.delete(sessionId);
      }
    }
  }

  /**
   * The shared pipeline every ingestion method runs after building its own
   * bundle-specific events: durable persistence (before anything else may
   * affect the live score, RFC §9) -> Fusion Engine -> recovery-aware
   * Lifecycle FSM (M7) -> Decision Engine -> Evidence Report Engine (only
   * when a `Decision` carries an `Alert`).
   */
  private async runPipeline(
    sessionId: string,
    events: readonly NewEvidenceEvent[],
    now: Date,
    explicitContradiction?: ContradictionSignal,
  ): Promise<IngestEvidenceResult> {
    return this.withSessionLock(sessionId, async () => {
      for (const event of events) {
        await this.evidenceRepository.append(event);
      }

      const persistedEvidence = await this.evidenceRepository.listAllBySession(sessionId);
      const contradiction =
        explicitContradiction ?? extractContradictionSignal(events, persistedEvidence) ?? undefined;
      const rawCandidateEvaluation = await this.candidateConfidenceEngine.evaluate(
        sessionId,
        persistedEvidence,
        now,
      );
      const candidateEvaluation =
        this.confidenceCalibrator === undefined
          ? rawCandidateEvaluation
          : this.confidenceCalibrator.calibrateEvaluation(rawCandidateEvaluation);
      this.candidateConfidenceEngine.rememberTable(candidateEvaluation.table);
      const posterior = candidateEvaluation.selectedPosterior;
      const transition = await this.lifecycleStore.evaluate(
        sessionId,
        posterior,
        now,
        contradiction,
      );
      const decision = this.decisionEngine.decide({
        sessionId,
        transition,
        posterior,
        evidence: persistedEvidence,
        now,
      });

      const report =
        decision.alert === null
          ? null
          : this.explanationEngine.buildReport({
              sessionId,
              lifecycleState: decision.lifecycleState,
              posterior: decision.evidenceRef.posterior,
              events: decision.evidenceRef.events,
              generatedAt: decision.alert.raisedAt,
              contradictionMetrics: candidateEvaluation.contradictionMetrics,
              classification: candidateEvaluation.classification,
              topParticipantId: candidateEvaluation.table.topParticipantId,
              crossModalMetrics: candidateEvaluation.crossModalMetrics,
            });

      // RFC §8/§13: the narrative layer is a best-effort, non-critical addition on top of the
      // structured report -- never awaited into a failure, never able to change `decision`/`report`
      // above (both are already fully computed by this point).
      const narrative =
        report === null || this.llmNarrativeAdapter === undefined
          ? null
          : await this.llmNarrativeAdapter.generateNarrative(report);

      this.sessionEventBus?.publish(decision);

      this.aiMetricsRecorder?.recordSessionMetrics({
        sessionId,
        evaluatedAt: now,
        posterior,
        contradictionMetrics: candidateEvaluation.contradictionMetrics,
        crossModalMetrics: candidateEvaluation.crossModalMetrics,
        tickEvents: events,
        topParticipantId: candidateEvaluation.table.topParticipantId,
      });

      return { decision, report, narrative };
    });
  }
}
