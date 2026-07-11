import type { BundleName } from '@sherlock/contracts';
import type { EvidenceEvent } from '@sherlock/contracts';

import type { ClassifiedEvidenceItem, SessionEvidenceClassification } from '../evidenceClassification/index.js';
import { DEFAULT_HALF_LIFE_MS, decayWeight, signalLogLikelihoodRatio } from '../fusion/index.js';

export type ContradictionSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface EvidenceSourceRef {
  readonly bundle: BundleName;
  readonly signalName: string;
  readonly eventId: string;
}

/**
 * One decay-weighted contradiction against a candidate hypothesis. Internal
 * only — never exposed on HTTP APIs or persisted.
 */
export interface ContradictionRecord {
  readonly participantId: string;
  readonly conflictingParticipantId: string | null;
  readonly evidenceSource: EvidenceSourceRef;
  readonly severity: ContradictionSeverity;
  /** Decay-weighted strength in `[0, 1]` — naturally falls as evidence ages. */
  readonly confidence: number;
  readonly occurredAt: Date;
  readonly timestamp: Date;
  readonly decayWeight: number;
}

export interface ParticipantContradictionMetrics {
  readonly participantId: string;
  readonly agreementScore: number;
  readonly contradictionScore: number;
  readonly consistencyScore: number;
  readonly contradictions: readonly ContradictionRecord[];
}

export interface SessionContradictionMetrics {
  readonly sessionId: string;
  readonly evaluatedAt: Date;
  readonly byParticipant: readonly ParticipantContradictionMetrics[];
}

export interface ContradictionMetricsOptions {
  readonly halfLifeMs?: number;
}

const HIGH_SEVERITY_LOG_LR = 0.25;
const MEDIUM_SEVERITY_LOG_LR = 0.08;
const MAX_REFERENCE_LOG_LR = 0.3;

function evidenceCorrelationKey(item: ClassifiedEvidenceItem): string {
  return `${item.bundle}:${item.signalName}:${item.occurredAt.getTime()}`;
}

function severityFromMagnitude(absLogLikelihoodRatio: number): ContradictionSeverity {
  if (absLogLikelihoodRatio >= HIGH_SEVERITY_LOG_LR) return 'HIGH';
  if (absLogLikelihoodRatio >= MEDIUM_SEVERITY_LOG_LR) return 'MEDIUM';
  return 'LOW';
}

function buildClassificationIndex(
  classification: SessionEvidenceClassification,
): Map<string, Map<string, ClassifiedEvidenceItem['classification']>> {
  const index = new Map<string, Map<string, ClassifiedEvidenceItem['classification']>>();

  for (const participant of classification.byParticipant) {
    for (const item of participant.items) {
      const key = evidenceCorrelationKey(item);
      const byParticipant = index.get(key) ?? new Map<string, ClassifiedEvidenceItem['classification']>();
      byParticipant.set(participant.participantId, item.classification);
      index.set(key, byParticipant);
    }
  }

  return index;
}

function findConflictingParticipant(
  item: ClassifiedEvidenceItem,
  index: Map<string, Map<string, ClassifiedEvidenceItem['classification']>>,
): string | null {
  const byParticipant = index.get(evidenceCorrelationKey(item));
  if (byParticipant === undefined) return null;

  for (const [otherParticipantId, otherClassification] of byParticipant.entries()) {
    if (otherParticipantId === item.participantId) continue;
    if (otherClassification === 'SUPPORTS') return otherParticipantId;
  }

  return null;
}

function contradictionConfidence(decay: number, absLogLikelihoodRatio: number): number {
  const magnitude = Math.min(1, absLogLikelihoodRatio / MAX_REFERENCE_LOG_LR);
  return decay * magnitude;
}

function computeParticipantMetrics(
  participantId: string,
  items: readonly ClassifiedEvidenceItem[],
  evaluatedAt: Date,
  classificationIndex: Map<string, Map<string, ClassifiedEvidenceItem['classification']>>,
  eventsById: ReadonlyMap<string, EvidenceEvent>,
  halfLifeMs: number,
): ParticipantContradictionMetrics {
  let supportWeight = 0;
  let contradictWeight = 0;
  const contradictions: ContradictionRecord[] = [];

  for (const item of items) {
    if (item.classification === 'NEUTRAL') continue;

    const weight = decayWeight(item.occurredAt, evaluatedAt, halfLifeMs);
    if (item.classification === 'SUPPORTS') {
      supportWeight += weight;
      continue;
    }

    contradictWeight += weight;

    const sourceEvent = eventsById.get(item.eventId);
    const absLogLr =
      sourceEvent === undefined
        ? MEDIUM_SEVERITY_LOG_LR
        : Math.abs(signalLogLikelihoodRatio(sourceEvent));

    contradictions.push({
      participantId,
      conflictingParticipantId: findConflictingParticipant(item, classificationIndex),
      evidenceSource: {
        bundle: item.bundle,
        signalName: item.signalName,
        eventId: item.eventId,
      },
      severity: severityFromMagnitude(absLogLr),
      confidence: contradictionConfidence(weight, absLogLr),
      occurredAt: item.occurredAt,
      timestamp: evaluatedAt,
      decayWeight: weight,
    });
  }

  const activeWeight = supportWeight + contradictWeight;
  const agreementScore = activeWeight > 0 ? supportWeight / activeWeight : 1;
  const contradictionScore = activeWeight > 0 ? contradictWeight / activeWeight : 0;
  const consistencyScore =
    activeWeight > 0 ? (supportWeight - contradictWeight) / activeWeight : 1;
  const normalizedConsistency = (consistencyScore + 1) / 2;

  contradictions.sort((a, b) => b.confidence - a.confidence);

  return {
    participantId,
    agreementScore,
    contradictionScore,
    consistencyScore: normalizedConsistency,
    contradictions,
  };
}

/**
 * Derives decay-weighted agreement / contradiction / consistency scores and
 * structured contradiction records from an existing classification table.
 * Uses the Fusion Engine's `decayWeight` half-life model so resolved or
 * stale contradictions naturally lose influence over time without changing
 * fusion mathematics.
 */
export function computeSessionContradictionMetrics(
  classification: SessionEvidenceClassification,
  eventsById: ReadonlyMap<string, EvidenceEvent>,
  options: ContradictionMetricsOptions = {},
): SessionContradictionMetrics {
  const halfLifeMs = options.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;
  const classificationIndex = buildClassificationIndex(classification);

  return {
    sessionId: classification.sessionId,
    evaluatedAt: classification.evaluatedAt,
    byParticipant: classification.byParticipant.map((participant) =>
      computeParticipantMetrics(
        participant.participantId,
        participant.items,
        classification.evaluatedAt,
        classificationIndex,
        eventsById,
        halfLifeMs,
      ),
    ),
  };
}

export function indexEvidenceEvents(
  events: readonly EvidenceEvent[],
): Map<string, EvidenceEvent> {
  return new Map(events.map((event) => [event.id, event]));
}
