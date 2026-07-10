import type { BundleName, EvidenceEvent } from '@sherlock/contracts';

import { betaCredibleInterval } from './beta.js';
import { DEFAULT_HALF_LIFE_MS, decayWeight } from './decay.js';
import { signalLogLikelihoodRatio } from './likelihoodRatios.js';
import { DEFAULT_LOG_LR_CLAMP, clampLogLikelihoodRatio } from './logLikelihoodRatioClamp.js';
import type { BundleContribution, FusionPosterior } from './types.js';

/** `log O_0 = 0` is 50/50 prior odds — no pre-call identity-claim-strength/base-rate prior computation exists yet (that composition is not specified by any milestone through M3); callers may override explicitly per session once one does. */
const DEFAULT_PRIOR_LOG_ODDS = 0;

/** Baseline Beta concentration (`alpha + beta`) with zero evidence: `Beta(1, 1)` — the uniform distribution, i.e. maximally uncertain, matching RFC §10's "sparse-and-uncertain" characterization for a session with nothing observed yet. */
const DEFAULT_BASELINE_CONCENTRATION = 2;

const DEFAULT_CREDIBLE_MASS = 0.9;

export interface FusionEngineOptions {
  /** `log O_0` — defaults to `0` (50/50). */
  readonly priorLogOdds?: number;
  readonly halfLifeMs?: number;
  /** Beta `alpha + beta` with zero accumulated evidence. Must be positive. */
  readonly baselineConcentration?: number;
  /** Credible-interval mass, e.g. `0.9` for a 90% interval. Must be within (0, 1). */
  readonly credibleMass?: number;
  /** The per-event log-LR clamp (RFC §13, ADR-12; Plan M14). Must be positive. */
  readonly logLrClamp?: number;
}

function sigmoid(logOdds: number): number {
  return 1 / (1 + Math.exp(-logOdds));
}

/**
 * The Fusion Engine (RFC §5, ADR-1): turns a session's persisted evidence
 * ledger into one calibrated, explainable posterior.
 *
 * Takes `EvidenceEvent[]` (the persisted, `id`/`recordedAt`-bearing shape),
 * never `NewEvidenceEvent` — structurally enforcing Plan §9's
 * "ledger-authoritative-before-score ordering" invariant: an event cannot
 * affect this engine's output unless it has already gone through
 * `EvidenceEventRepository.append` (M1).
 */
export class FusionEngine {
  private readonly priorLogOdds: number;
  private readonly halfLifeMs: number;
  private readonly baselineConcentration: number;
  private readonly credibleMass: number;
  private readonly logLrClamp: number;

  constructor(options: FusionEngineOptions = {}) {
    this.priorLogOdds = options.priorLogOdds ?? DEFAULT_PRIOR_LOG_ODDS;
    this.halfLifeMs = options.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;
    this.baselineConcentration = options.baselineConcentration ?? DEFAULT_BASELINE_CONCENTRATION;
    this.credibleMass = options.credibleMass ?? DEFAULT_CREDIBLE_MASS;
    this.logLrClamp = options.logLrClamp ?? DEFAULT_LOG_LR_CLAMP;

    if (!(this.baselineConcentration > 0)) {
      throw new RangeError(
        `baselineConcentration must be positive, received ${this.baselineConcentration}`,
      );
    }
    if (!(this.logLrClamp > 0)) {
      throw new RangeError(`logLrClamp must be positive, received ${this.logLrClamp}`);
    }
  }

  /**
   * Computes the posterior for `sessionId` from `events`. Callers pass
   * exactly the events belonging to one session (this method does not
   * filter by `sessionId` itself, so a caller error surfaces immediately
   * rather than silently mixing sessions).
   *
   * `SERVICE_UNAVAILABLE` events are excluded entirely before any other
   * step (RFC §13, ADR-11) — never decayed, never summed, never counted in
   * `eligibleEventCount`. Everything else (`OK`, `NO_SIGNAL_DETECTED`) is
   * decayed per §7 and combined bundle-local-first, then summed globally
   * (§5's additive log-odds structure).
   */
  computePosterior(
    sessionId: string,
    events: readonly EvidenceEvent[],
    evaluatedAt: Date = new Date(),
  ): FusionPosterior {
    const eligible = events.filter(
      (event) => event.sessionId === sessionId && event.healthStatus !== 'SERVICE_UNAVAILABLE',
    );

    const bundleTotals = new Map<BundleName, { logOdds: number; eligibleEventCount: number }>();
    let totalAbsoluteWeight = 0;

    /** Bundles whose log-odds contribution is effectively zero must not count toward tier diversity (RFC §6 "multi-bundle evidence"). */
    const MEANINGFUL_CONTRIBUTION_EPSILON = 1e-12;

    for (const event of eligible) {
      const rawLogLR = signalLogLikelihoodRatio(event);
      const weight = decayWeight(event.occurredAt, evaluatedAt, this.halfLifeMs);
      // ADR-12: clamp the *actual contribution* this single event may add to the sum, after
      // decay -- bounding what a compromised, buggy, or mis-calibrated signal can do to the
      // score regardless of how large a raw magnitude it reports.
      const decayedContribution = clampLogLikelihoodRatio(rawLogLR * weight, this.logLrClamp);

      if (Math.abs(decayedContribution) <= MEANINGFUL_CONTRIBUTION_EPSILON) {
        continue;
      }

      const bucket = bundleTotals.get(event.bundle) ?? { logOdds: 0, eligibleEventCount: 0 };
      bucket.logOdds += decayedContribution;
      bucket.eligibleEventCount += 1;
      bundleTotals.set(event.bundle, bucket);

      totalAbsoluteWeight += Math.abs(decayedContribution);
    }

    const bundleContributions: BundleContribution[] = [...bundleTotals.entries()].map(
      ([bundle, totals]) => ({
        bundle,
        logOddsContribution: totals.logOdds,
        eligibleEventCount: totals.eligibleEventCount,
      }),
    );

    const logOdds =
      this.priorLogOdds +
      bundleContributions.reduce((sum, contribution) => sum + contribution.logOddsContribution, 0);
    const probability = sigmoid(logOdds);

    const concentration = this.baselineConcentration + totalAbsoluteWeight;
    const alpha = probability * concentration;
    const beta = (1 - probability) * concentration;
    const credibleInterval = betaCredibleInterval(alpha, beta, this.credibleMass);

    return {
      sessionId,
      evaluatedAt,
      logOdds,
      probability,
      beta: { alpha, beta },
      credibleInterval,
      bundleContributions,
      eligibleEventCount: eligible.length,
    };
  }
}
