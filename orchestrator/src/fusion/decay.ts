/**
 * Time-decay for ordinary evidence (RFC §7): "Ordinary evidence decays
 * exponentially, half-life on the order of a typical interview's length
 * (tunable, §16)." This module implements only the ordinary-decay half of
 * §7 — the asymmetric exception ("change-point-flagged evidence never
 * decays in the audit ledger") does not apply here, because change-point
 * events don't exist yet (RFC §5's CUSUM layer arrives with Visual/Audio
 * bundles at Plan M9); every event this Fusion Engine sees through M3 is
 * ordinary evidence.
 */

/** 45 minutes: "on the order of a typical interview's length" (RFC §7), tunable per §16. */
export const DEFAULT_HALF_LIFE_MS = 45 * 60 * 1000;

/**
 * Returns the decay weight `w` for an event observed at `occurredAt`, as of
 * `evaluatedAt`, using exponential half-life decay: `w = 2^(-elapsed/halfLife)`.
 * An event timestamped after `evaluatedAt` (clock skew, or evaluating
 * against a past instant) is treated as having zero elapsed time — a
 * decay weight can never exceed 1, i.e. evidence is never amplified by
 * decay.
 */
export function decayWeight(
  occurredAt: Date,
  evaluatedAt: Date,
  halfLifeMs: number = DEFAULT_HALF_LIFE_MS,
): number {
  if (halfLifeMs <= 0) {
    throw new RangeError(`halfLifeMs must be positive, received ${halfLifeMs}`);
  }
  const elapsedMs = Math.max(0, evaluatedAt.getTime() - occurredAt.getTime());
  return Math.pow(2, -elapsedMs / halfLifeMs);
}
