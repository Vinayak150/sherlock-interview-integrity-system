import type { BundleName } from '@sherlock/contracts';

/**
 * The direction a single evidence event pushes the posterior (RFC §5).
 * `NEUTRAL` covers both "nothing to compare" (`NO_SIGNAL_DETECTED`) and any
 * signal this registry does not (yet) assign a likelihood ratio to — in
 * both cases the event must contribute exactly zero, never be silently
 * dropped in a way that could later be mistaken for a negative (§7:
 * absence of evidence is not evidence of absence).
 */
export type SignalOutcome = 'SUPPORTS' | 'CONTRADICTS' | 'NEUTRAL';

/**
 * A hand-set, expert-elicited likelihood-ratio magnitude for one signal
 * (RFC §5's "Tradeoffs": "Hand-set, expert-elicited likelihood ratios at
 * launch encode judgment, not measurement, until enough labeled outcomes
 * accumulate to calibrate them empirically"). Both magnitudes are natural-
 * log units of the likelihood ratio `P(e|genuine)/P(e|impostor)`;
 * `supportsLogLR` must be positive, `contradictsLogLR` must be negative —
 * enforced by `LikelihoodRatioRegistry`'s registration helper, not
 * re-checked by every caller.
 */
export interface LikelihoodRatioSpec {
  readonly supportsLogLR: number;
  readonly contradictsLogLR: number;
}

/** Reads a signal's raw `EvidenceEvent.value` and classifies its direction, ignoring health status (the caller applies the signal-health contract before this runs). */
export type OutcomeExtractor = (value: unknown) => SignalOutcome;

export interface BundleContribution {
  readonly bundle: BundleName;
  /** Sum of this bundle's decayed, signed log-LR contributions. */
  readonly logOddsContribution: number;
  /** Number of eligible (non-`SERVICE_UNAVAILABLE`) events considered from this bundle. */
  readonly eligibleEventCount: number;
}

export interface BetaParameters {
  readonly alpha: number;
  readonly beta: number;
}

export interface CredibleInterval {
  readonly lower: number;
  readonly upper: number;
  /** The probability mass captured between `lower` and `upper`, e.g. `0.9` for a 90% interval. */
  readonly mass: number;
}

/**
 * The Fusion Engine's output for one session at one evaluation instant
 * (RFC §5's "Uncertainty representation"): a calibrated confidence
 * (`probability`, `logOdds`) carried alongside a Beta posterior so
 * "sparse-and-uncertain" and "abundant-and-contradictory" stay
 * distinguishable downstream (§10) — never collapsed into one number.
 */
export interface FusionPosterior {
  readonly sessionId: string;
  readonly evaluatedAt: Date;
  readonly logOdds: number;
  /** Effective confidence used by lifecycle, decision, and explanation layers. */
  readonly probability: number;
  /**
   * Fusion-engine probability before optional post-hoc calibration. When
   * calibration is disabled this equals `probability`.
   */
  readonly rawProbability?: number;
  readonly beta: BetaParameters;
  readonly credibleInterval: CredibleInterval;
  readonly bundleContributions: readonly BundleContribution[];
  /** Count of events considered eligible for fusion (`SERVICE_UNAVAILABLE` events are excluded upstream, per §13, and never counted here). */
  readonly eligibleEventCount: number;
}
