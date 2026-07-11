import type { EvidenceEvent } from '@sherlock/contracts';

import { resolveSignalOutcome } from '../fusion/index.js';
import type {
  ClassifiedEvidenceItem,
  EvidenceClassification,
  ParticipantEvidenceClassification,
  SessionEvidenceClassification,
} from './types.js';

/** Used when no participant pool exists yet — session-wide, unscoped classification. */
export const UNSCOPED_PARTICIPANT_ID = '__unscoped__';

/**
 * Classifies one evidence event against a candidate hypothesis.
 *
 * Classification reuses the Fusion Engine's existing outcome extractors
 * (`resolveSignalOutcome`) so confidence math stays unchanged — this module
 * only makes the SUPPORTS / CONTRADICTS / NEUTRAL stance explicit and
 * attributes it to a participant hypothesis.
 */
export function classifyEvidenceEvent(
  event: EvidenceEvent,
  participantId: string,
): ClassifiedEvidenceItem {
  return {
    eventId: event.id,
    sessionId: event.sessionId,
    participantId,
    bundle: event.bundle,
    signalName: event.signalName,
    healthStatus: event.healthStatus,
    classification: resolveClassification(event),
    occurredAt: event.occurredAt,
  };
}

export function classifyEvidenceLedger(
  events: readonly EvidenceEvent[],
  participantId: string,
  sessionId?: string,
): readonly ClassifiedEvidenceItem[] {
  const scoped =
    sessionId === undefined ? events : events.filter((event) => event.sessionId === sessionId);
  return scoped.map((event) => classifyEvidenceEvent(event, participantId));
}

export function buildParticipantClassification(
  participantId: string,
  events: readonly EvidenceEvent[],
): ParticipantEvidenceClassification {
  return {
    participantId,
    items: classifyEvidenceLedger(events, participantId),
  };
}

export function buildSessionEvidenceClassification(
  sessionId: string,
  evaluatedAt: Date,
  classifications: readonly ParticipantEvidenceClassification[],
): SessionEvidenceClassification {
  return {
    sessionId,
    evaluatedAt,
    byParticipant: classifications,
  };
}

function resolveClassification(event: EvidenceEvent): EvidenceClassification {
  if (
    event.healthStatus === 'SERVICE_UNAVAILABLE' ||
    event.healthStatus === 'NO_SIGNAL_DETECTED'
  ) {
    // Absence of evidence is never evidence against (RFC §7) — explicit NEUTRAL.
    return 'NEUTRAL';
  }

  return resolveSignalOutcome(event);
}
