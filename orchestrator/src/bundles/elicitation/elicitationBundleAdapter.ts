import type {
  ElicitationChallengeType,
  ElicitationResponseValue,
  NewEvidenceEvent,
} from '@sherlock/contracts';

import type { BundleAdapter } from '../types.js';
import { makeEvidenceEvent } from '../types.js';

/**
 * `satisfied: null` means the challenge was issued but no response was
 * captured yet (or it timed out) — absence of evidence, never treated as
 * a failed challenge (RFC §7).
 */
export interface ElicitationBundleInput {
  readonly challengeType: ElicitationChallengeType;
  readonly satisfied: boolean | null;
}

/**
 * The Active-Elicitation Bundle Adapter (RFC §4-G; Plan M11). Per §10's
 * tie-breaking and §11's edge-case fallbacks, this bundle's evidence
 * exists *because* the Decision Engine (M5, extended this milestone)
 * recommended a specific challenge — the Decision Engine's
 * `elicitationTrigger` field and this adapter are the two ends of that
 * loop: recommend -> (an Interviewer UI delivers it, Plan M13, not built
 * here) -> observe the response -> feed it back in through this adapter.
 */
export class ElicitationBundleAdapter implements BundleAdapter<ElicitationBundleInput> {
  readonly bundle = 'elicitation' as const;

  buildEvidenceEvents(
    sessionId: string,
    input: ElicitationBundleInput,
    occurredAt: Date = new Date(),
  ): readonly NewEvidenceEvent[] {
    const value: ElicitationResponseValue = {
      challengeType: input.challengeType,
      satisfied: input.satisfied,
    };
    return [
      makeEvidenceEvent({
        sessionId,
        bundle: this.bundle,
        signalName: 'active_elicitation_response',
        healthStatus: input.satisfied === null ? 'NO_SIGNAL_DETECTED' : 'OK',
        value,
        occurredAt,
      }),
    ];
  }
}
