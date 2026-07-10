import type { BundleName, EvidenceEvent, NewEvidenceEvent } from '@sherlock/contracts';

import type { ContradictionSignal } from '../statemachine/index.js';

/**
 * Extracts a `ContradictionSignal` (the seam `statemachine/lifecycle.ts`,
 * M4, deliberately left abstract) from a batch of evidence events, if any
 * of them is a flagged change-point (RFC §5; Plan M9). Kept as a small,
 * separate function — never folded into a Bundle Adapter's
 * `buildEvidenceEvents` — so adapters keep conforming exactly to the
 * established `BundleAdapter<TInput>` shape (M2): one array of events out,
 * nothing else. A caller (the future orchestration layer wiring bundles
 * into the Lifecycle FSM) calls this separately on the returned events.
 */
const CHANGE_POINT_SIGNAL_NAMES: ReadonlySet<string> = new Set([
  'face_embedding_change_point',
  'voice_embedding_change_point',
]);

function isChangePointDetected(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { detected?: unknown }).detected === true
  );
}

function flaggedChangePointBundles(
  events: readonly Pick<EvidenceEvent | NewEvidenceEvent, 'bundle' | 'signalName' | 'healthStatus' | 'value'>[],
): ReadonlySet<BundleName> {
  const bundles = new Set<BundleName>();
  for (const event of events) {
    if (
      event.healthStatus === 'OK' &&
      CHANGE_POINT_SIGNAL_NAMES.has(event.signalName) &&
      isChangePointDetected(event.value)
    ) {
      bundles.add(event.bundle);
    }
  }
  return bundles;
}

/**
 * RFC §6: `DISQUALIFIED` requires corroborating cross-bundle evidence, not
 * a single-bundle CUSUM fire alone. Corroboration is satisfied when change-
 * points are flagged in two or more distinct bundles across the full session
 * ledger (including the current batch, which must already be persisted).
 */
export function extractContradictionSignal(
  currentBatch: readonly NewEvidenceEvent[],
  sessionEvidence: readonly EvidenceEvent[],
): ContradictionSignal | null {
  const flagged = currentBatch.find(
    (event) =>
      event.healthStatus === 'OK' &&
      CHANGE_POINT_SIGNAL_NAMES.has(event.signalName) &&
      isChangePointDetected(event.value),
  );
  if (flagged === undefined) return null;

  const corroborated = flaggedChangePointBundles([...sessionEvidence, ...currentBatch]).size >= 2;

  return {
    detectedAt: flagged.occurredAt,
    reason: `${flagged.bundle} bundle change-point detected (${flagged.signalName})`,
    bundle: flagged.bundle,
    corroborated,
  };
}
