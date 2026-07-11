import type { BundleName, SignalHealthStatus } from '@sherlock/contracts';

import type { SignalOutcome } from '../fusion/index.js';

/** Explicit per-item stance toward a candidate hypothesis (RFC §5 direction). */
export type EvidenceClassification = SignalOutcome;

/**
 * One persisted evidence event classified against a single candidate
 * hypothesis. Internal only — never written to the Evidence Store or
 * exposed on HTTP APIs.
 */
export interface ClassifiedEvidenceItem {
  readonly eventId: string;
  readonly sessionId: string;
  readonly participantId: string;
  readonly bundle: BundleName;
  readonly signalName: string;
  readonly healthStatus: SignalHealthStatus;
  readonly classification: EvidenceClassification;
  readonly occurredAt: Date;
}

/** All classified items for one participant hypothesis at one instant. */
export interface ParticipantEvidenceClassification {
  readonly participantId: string;
  readonly items: readonly ClassifiedEvidenceItem[];
}

/**
 * Session-wide classification table keyed by candidate hypothesis.
 * Populated on every pipeline tick after evidence is persisted.
 */
export interface SessionEvidenceClassification {
  readonly sessionId: string;
  readonly evaluatedAt: Date;
  readonly byParticipant: readonly ParticipantEvidenceClassification[];
}
