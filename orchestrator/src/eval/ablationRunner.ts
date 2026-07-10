import type { BundleName, EvidenceEvent } from '@sherlock/contracts';

import type { FusionEngine } from '../fusion/index.js';

/**
 * The ablation runner (Plan M15: "ablation tooling ... as first-class").
 * Measures each bundle's marginal contribution to a session's final
 * posterior by recomputing it with that one bundle's events entirely
 * removed — a direct, empirical answer to "how much did the Visual
 * bundle actually matter for this session," useful both for debugging a
 * specific session and, aggregated across many sessions (not built here
 * -- that aggregation is this tool's caller's job), for validating that
 * ADR-16's "near-zero" Device/OS weighting claim actually holds in
 * practice.
 */
export interface AblationResult {
  readonly excludedBundle: BundleName;
  readonly probabilityWithAllBundles: number;
  readonly probabilityWithoutBundle: number;
  /** `probabilityWithAllBundles - probabilityWithoutBundle` -- positive means this bundle pushed the probability up; negative means it pushed it down. */
  readonly probabilityDelta: number;
  readonly eventCountRemoved: number;
}

export function runAblation(
  fusionEngine: FusionEngine,
  sessionId: string,
  events: readonly EvidenceEvent[],
  evaluatedAt: Date,
): readonly AblationResult[] {
  const baseline = fusionEngine.computePosterior(sessionId, events, evaluatedAt);
  const bundlesPresent = [...new Set(events.map((event) => event.bundle))];

  return bundlesPresent.map((bundle) => {
    const withoutBundle = events.filter((event) => event.bundle !== bundle);
    const posteriorWithoutBundle = fusionEngine.computePosterior(
      sessionId,
      withoutBundle,
      evaluatedAt,
    );

    return {
      excludedBundle: bundle,
      probabilityWithAllBundles: baseline.probability,
      probabilityWithoutBundle: posteriorWithoutBundle.probability,
      probabilityDelta: baseline.probability - posteriorWithoutBundle.probability,
      eventCountRemoved: events.length - withoutBundle.length,
    };
  });
}
