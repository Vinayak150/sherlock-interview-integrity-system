import type { BiographicalClaimConsistencyValue, NewEvidenceEvent } from '@sherlock/contracts';

import type { BundleAdapter } from '../types.js';
import { makeEvidenceEvent } from '../types.js';

/**
 * One biographical claim topic (e.g. "employer," "school," "prior role")
 * as stated during the interview, compared against the filed application
 * record — RFC §4-E's "self-consistency of biographical claims against
 * the filed application." `observedValue`/`claimedValue` are `null` when
 * that side of the comparison was not available this tick.
 */
export interface ObservedBiographicalClaim {
  readonly claimTopic: string;
  readonly observedValue: string | null;
  readonly claimedValue: string | null;
}

export interface LinguisticBundleInput {
  readonly claims: readonly ObservedBiographicalClaim[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The Linguistic Bundle Adapter (RFC §4-E; Plan M11). Deliberately scoped
 * to *identity*-consistency only — the RFC's own scope boundary
 * (correction #4): "Explicitly excluded: answer quality, technical
 * correctness, response latency as a *competence* signal — these belong
 * to interview evaluation, not identity." This adapter has no concept of
 * whether an answer was *good*, only whether it is self-consistent with
 * the filed application.
 */
export class LinguisticBundleAdapter implements BundleAdapter<LinguisticBundleInput> {
  readonly bundle = 'linguistic' as const;

  buildEvidenceEvents(
    sessionId: string,
    input: LinguisticBundleInput,
    occurredAt: Date = new Date(),
  ): readonly NewEvidenceEvent[] {
    return input.claims.map((claim) => {
      const bothPresent = claim.observedValue !== null && claim.claimedValue !== null;
      const consistent = bothPresent
        ? normalize(claim.observedValue as string) === normalize(claim.claimedValue as string)
        : null;
      const value: BiographicalClaimConsistencyValue = { consistent, claimTopic: claim.claimTopic };
      return makeEvidenceEvent({
        sessionId,
        bundle: this.bundle,
        signalName: 'biographical_claim_consistency',
        healthStatus: bothPresent ? 'OK' : 'NO_SIGNAL_DETECTED',
        value,
        occurredAt,
      });
    });
  }
}
