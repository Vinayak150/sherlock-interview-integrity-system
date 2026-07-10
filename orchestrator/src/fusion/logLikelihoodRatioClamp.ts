/**
 * The per-event log-likelihood-ratio clamp (RFC §13, ADR-12): "a hard
 * clamp on the maximum log-likelihood-ratio magnitude any single event
 * can contribute, so no one signal — compromised, buggy, or simply
 * mis-calibrated — can unilaterally swing a session across multiple
 * confidence tiers." Plan M14: "make ... the per-event log-LR clamp
 * verifiably load-bearing end-to-end."
 *
 * This is what makes the bundle-local dependency structure (§5, ADR-1)
 * safe to adopt at all (§13's own cross-reference) and bounds the
 * modular monolith's larger in-process blast radius (§9.2's Committee
 * Note) — a single compromised bundle-local combiner still cannot swing
 * the overall score arbitrarily, regardless of what magnitude it tries to
 * report.
 */

/**
 * Comfortably above the largest legitimate registered magnitude in
 * `likelihoodRatios.ts` (currently `visual_liveness`'s `contradictsLogLR:
 * -0.5`), so no correctly-calibrated signal is ever clamped in ordinary
 * operation — this only engages for a signal that is compromised, buggy,
 * or has drifted far out of calibration. Phase-1, hand-set (RFC §5's own
 * "judgment, not measurement" caveat applies here too); revisit once
 * enough legitimate signal magnitudes have been calibrated from labeled
 * outcomes (§16) to know the clamp is still comfortably outside that
 * range.
 */
export const DEFAULT_LOG_LR_CLAMP = 0.6;

/** Clamps `logLR` to `[-clamp, clamp]`. `clamp` must be positive. */
export function clampLogLikelihoodRatio(
  logLR: number,
  clamp: number = DEFAULT_LOG_LR_CLAMP,
): number {
  if (!(clamp > 0)) {
    throw new RangeError(`clamp must be positive, received ${clamp}`);
  }
  return Math.max(-clamp, Math.min(clamp, logLR));
}
