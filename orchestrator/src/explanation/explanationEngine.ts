import type { EvidenceEvent } from '@sherlock/contracts';

import {
  DEFAULT_HALF_LIFE_MS,
  decayWeight,
  resolveSignalOutcome,
  signalLogLikelihoodRatio,
} from '../fusion/index.js';
import type { FusionPosterior } from '../fusion/index.js';
import type { LifecycleState } from '../statemachine/index.js';
import type { ContributingSignal, EvidenceReport, MissingEvidenceItem } from './types.js';

/** A generous but bounded cap, so a long session's full evidence ledger never produces an unbounded report by default. Overridable per call site (e.g. a compliance audit export). */
const DEFAULT_MAX_TOP_SIGNALS = 20;

export interface ExplanationEngineOptions {
  /** Must match the half-life the Fusion Engine (M3) used to produce `posterior`, so ranked contributions stay consistent with that posterior's own math. Defaults to the same `DEFAULT_HALF_LIFE_MS` the Fusion Engine defaults to. */
  readonly halfLifeMs?: number;
  readonly maxTopSignals?: number;
}

export interface BuildReportInput {
  readonly sessionId: string;
  readonly lifecycleState: LifecycleState;
  readonly posterior: FusionPosterior;
  readonly events: readonly EvidenceEvent[];
  readonly generatedAt?: Date;
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

  constructor(options: ExplanationEngineOptions = {}) {
    this.halfLifeMs = options.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;
    this.maxTopSignals = options.maxTopSignals ?? DEFAULT_MAX_TOP_SIGNALS;
    assertPositive('halfLifeMs', this.halfLifeMs);
    assertPositive('maxTopSignals', this.maxTopSignals);
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

      const outcome = resolveSignalOutcome(event);
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

    return {
      sessionId: input.sessionId,
      generatedAt,
      lifecycleState: input.lifecycleState,
      probability: input.posterior.probability,
      topContributingSignals: rankedSignals.slice(0, this.maxTopSignals),
      contradictoryEvidence: rankedSignals.filter((signal) => signal.outcome === 'CONTRADICTS'),
      missingEvidence,
      alternativeHypotheses: [],
    };
  }
}
