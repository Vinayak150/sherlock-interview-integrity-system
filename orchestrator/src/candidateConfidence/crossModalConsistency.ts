import type { BundleName } from '@sherlock/contracts';
import type { EvidenceEvent } from '@sherlock/contracts';

import type { SessionEvidenceClassification } from '../evidenceClassification/index.js';
import type { ClassifiedEvidenceItem } from '../evidenceClassification/types.js';
import { DEFAULT_HALF_LIFE_MS, decayWeight } from '../fusion/index.js';
import type {
  ParticipantContradictionMetrics,
  SessionContradictionMetrics,
} from './contradictionMetrics.js';

export type CrossModalModality = 'face' | 'speaker' | 'metadata' | 'transcript';

export type ModalityIdentityStance = 'ALIGNED' | 'CONTRADICTING' | 'UNKNOWN';

export interface ModalityIdentityAssessment {
  readonly modality: CrossModalModality;
  readonly stance: ModalityIdentityStance;
  /** Modality-local confidence in `[0, 1]` (similarity, semantic confidence, or decay weight). */
  readonly confidence: number;
  readonly bundle: BundleName;
  readonly signalName: string;
  readonly occurredAt: Date | null;
}

export interface ParticipantCrossModalMetrics {
  readonly participantId: string;
  readonly modalities: readonly ModalityIdentityAssessment[];
  readonly crossModalConsistency: number;
  readonly crossModalConfidence: number;
  readonly crossModalDisagreement: number;
}

export interface SessionCrossModalMetrics {
  readonly sessionId: string;
  readonly evaluatedAt: Date;
  readonly byParticipant: readonly ParticipantCrossModalMetrics[];
}

export interface CrossModalConsistencyOptions {
  readonly halfLifeMs?: number;
}

const FACE_SIGNAL = 'face_embedding_self_consistency';
const SPEAKER_SIGNAL = 'voice_embedding_self_consistency';
const TRANSCRIPT_SIGNAL = 'biographical_claim_consistency';
const METADATA_IDENTITY_SIGNALS = new Set([
  'display_name_match',
  'email_domain_match',
  'calendar_invite_match',
]);

const MODALITY_COUNT = 4;
const EMBEDDING_SIMILARITY_FLOOR = 0.7;

function latestItem(
  items: readonly ClassifiedEvidenceItem[],
  predicate: (item: ClassifiedEvidenceItem) => boolean,
): ClassifiedEvidenceItem | null {
  let latest: ClassifiedEvidenceItem | null = null;
  for (const item of items) {
    if (!predicate(item)) continue;
    if (
      latest === null ||
      item.occurredAt.getTime() > latest.occurredAt.getTime()
    ) {
      latest = item;
    }
  }
  return latest;
}

function classificationToStance(classification: ClassifiedEvidenceItem['classification']): ModalityIdentityStance {
  if (classification === 'SUPPORTS') return 'ALIGNED';
  if (classification === 'CONTRADICTS') return 'CONTRADICTING';
  return 'UNKNOWN';
}

function embeddingConfidence(
  event: EvidenceEvent | undefined,
  item: ClassifiedEvidenceItem,
  evaluatedAt: Date,
  halfLifeMs: number,
): number {
  const decay = decayWeight(item.occurredAt, evaluatedAt, halfLifeMs);
  if (event === undefined) return decay * 0.5;

  const value = event.value;
  if (typeof value !== 'object' || value === null) return decay * 0.5;

  const similarity = (value as { similarity?: unknown }).similarity;
  if (typeof similarity === 'number' && Number.isFinite(similarity)) {
    return decay * Math.max(0, Math.min(1, similarity));
  }

  if (item.classification === 'SUPPORTS') {
    return decay * EMBEDDING_SIMILARITY_FLOOR;
  }
  if (item.classification === 'CONTRADICTS') {
    return decay * (1 - EMBEDDING_SIMILARITY_FLOOR);
  }
  return 0;
}

function claimConfidence(
  event: EvidenceEvent | undefined,
  item: ClassifiedEvidenceItem,
  evaluatedAt: Date,
  halfLifeMs: number,
): number {
  const decay = decayWeight(item.occurredAt, evaluatedAt, halfLifeMs);
  if (event === undefined) return decay * (item.classification === 'SUPPORTS' ? 0.8 : 0.5);

  const value = event.value;
  if (typeof value !== 'object' || value === null) return decay * 0.5;

  const semantic = value as { confidence?: unknown; similarity?: unknown; matched?: unknown };
  if (typeof semantic.confidence === 'number' && Number.isFinite(semantic.confidence)) {
    return decay * Math.max(0, Math.min(1, semantic.confidence));
  }
  if (typeof semantic.similarity === 'number' && Number.isFinite(semantic.similarity)) {
    return decay * Math.max(0, Math.min(1, semantic.similarity));
  }
  if (semantic.matched === true) return decay * 0.85;
  if (semantic.matched === false) return decay * 0.75;
  return decay * 0.5;
}

function transcriptConfidence(
  event: EvidenceEvent | undefined,
  item: ClassifiedEvidenceItem,
  evaluatedAt: Date,
  halfLifeMs: number,
): number {
  const decay = decayWeight(item.occurredAt, evaluatedAt, halfLifeMs);
  if (event === undefined) return decay * 0.5;

  const value = event.value;
  if (typeof value !== 'object' || value === null) return decay * 0.5;

  const consistent = (value as { consistent?: unknown }).consistent;
  if (consistent === true || consistent === false) return decay;
  return 0;
}

function assessFace(
  items: readonly ClassifiedEvidenceItem[],
  eventsById: ReadonlyMap<string, EvidenceEvent>,
  evaluatedAt: Date,
  halfLifeMs: number,
): ModalityIdentityAssessment {
  const item = latestItem(
    items,
    (row) => row.bundle === 'visual' && row.signalName === FACE_SIGNAL,
  );
  if (item === null) {
    return {
      modality: 'face',
      stance: 'UNKNOWN',
      confidence: 0,
      bundle: 'visual',
      signalName: FACE_SIGNAL,
      occurredAt: null,
    };
  }

  return {
    modality: 'face',
    stance: classificationToStance(item.classification),
    confidence: embeddingConfidence(eventsById.get(item.eventId), item, evaluatedAt, halfLifeMs),
    bundle: item.bundle,
    signalName: item.signalName,
    occurredAt: item.occurredAt,
  };
}

function assessSpeaker(
  items: readonly ClassifiedEvidenceItem[],
  eventsById: ReadonlyMap<string, EvidenceEvent>,
  evaluatedAt: Date,
  halfLifeMs: number,
): ModalityIdentityAssessment {
  const item = latestItem(
    items,
    (row) => row.bundle === 'audio' && row.signalName === SPEAKER_SIGNAL,
  );
  if (item === null) {
    return {
      modality: 'speaker',
      stance: 'UNKNOWN',
      confidence: 0,
      bundle: 'audio',
      signalName: SPEAKER_SIGNAL,
      occurredAt: null,
    };
  }

  return {
    modality: 'speaker',
    stance: classificationToStance(item.classification),
    confidence: embeddingConfidence(eventsById.get(item.eventId), item, evaluatedAt, halfLifeMs),
    bundle: item.bundle,
    signalName: item.signalName,
    occurredAt: item.occurredAt,
  };
}

function assessMetadata(
  items: readonly ClassifiedEvidenceItem[],
  eventsById: ReadonlyMap<string, EvidenceEvent>,
  evaluatedAt: Date,
  halfLifeMs: number,
): ModalityIdentityAssessment {
  const metadataItems = items.filter(
    (row) => row.bundle === 'claim' && METADATA_IDENTITY_SIGNALS.has(row.signalName),
  );

  if (metadataItems.length === 0) {
    return {
      modality: 'metadata',
      stance: 'UNKNOWN',
      confidence: 0,
      bundle: 'claim',
      signalName: 'display_name_match',
      occurredAt: null,
    };
  }

  let supports = 0;
  let contradicts = 0;
  let confidenceTotal = 0;
  let latestOccurredAt: Date | null = null;

  for (const item of metadataItems) {
    if (item.classification === 'SUPPORTS') supports += 1;
    if (item.classification === 'CONTRADICTS') contradicts += 1;
    confidenceTotal += claimConfidence(eventsById.get(item.eventId), item, evaluatedAt, halfLifeMs);
    if (latestOccurredAt === null || item.occurredAt.getTime() > latestOccurredAt.getTime()) {
      latestOccurredAt = item.occurredAt;
    }
  }

  let stance: ModalityIdentityStance = 'UNKNOWN';
  if (contradicts > 0) stance = 'CONTRADICTING';
  else if (supports > 0) stance = 'ALIGNED';

  return {
    modality: 'metadata',
    stance,
    confidence: confidenceTotal / metadataItems.length,
    bundle: 'claim',
    signalName: 'display_name_match',
    occurredAt: latestOccurredAt,
  };
}

function assessTranscript(
  items: readonly ClassifiedEvidenceItem[],
  eventsById: ReadonlyMap<string, EvidenceEvent>,
  evaluatedAt: Date,
  halfLifeMs: number,
): ModalityIdentityAssessment {
  const item = latestItem(
    items,
    (row) => row.bundle === 'linguistic' && row.signalName === TRANSCRIPT_SIGNAL,
  );
  if (item === null) {
    return {
      modality: 'transcript',
      stance: 'UNKNOWN',
      confidence: 0,
      bundle: 'linguistic',
      signalName: TRANSCRIPT_SIGNAL,
      occurredAt: null,
    };
  }

  return {
    modality: 'transcript',
    stance: classificationToStance(item.classification),
    confidence: transcriptConfidence(eventsById.get(item.eventId), item, evaluatedAt, halfLifeMs),
    bundle: item.bundle,
    signalName: item.signalName,
    occurredAt: item.occurredAt,
  };
}

function modalityScores(
  modalities: readonly ModalityIdentityAssessment[],
  contradictionMetrics: ParticipantContradictionMetrics | null,
): Pick<
  ParticipantCrossModalMetrics,
  'crossModalConsistency' | 'crossModalConfidence' | 'crossModalDisagreement'
> {
  const known = modalities.filter((modality) => modality.stance !== 'UNKNOWN');
  const aligned = known.filter((modality) => modality.stance === 'ALIGNED').length;
  const contradicting = known.filter((modality) => modality.stance === 'CONTRADICTING').length;
  const coverage = known.length / MODALITY_COUNT;

  const face = modalities.find((modality) => modality.modality === 'face');
  const speaker = modalities.find((modality) => modality.modality === 'speaker');
  const biometricConflict =
    face !== undefined &&
    speaker !== undefined &&
    face.stance !== 'UNKNOWN' &&
    speaker.stance !== 'UNKNOWN' &&
    face.stance !== speaker.stance;

  let modalityDisagreement = 0;
  let modalityConsistency = 1;

  if (biometricConflict) {
    modalityDisagreement = 1;
    modalityConsistency = 0;
  } else if (known.length === 0) {
    modalityDisagreement = 0;
    modalityConsistency = 1;
  } else if (aligned > 0 && contradicting > 0) {
    modalityDisagreement = contradicting / (aligned + contradicting);
    modalityConsistency = (aligned / (aligned + contradicting)) * coverage;
  } else if (contradicting > 0) {
    modalityDisagreement = 1;
    modalityConsistency = 0;
  } else {
    modalityDisagreement = 0;
    modalityConsistency = coverage;
  }

  const modalityConfidence =
    known.length === 0
      ? 0
      : known.reduce((sum, modality) => sum + modality.confidence, 0) / known.length;

  const contradictionConsistency = contradictionMetrics?.consistencyScore ?? 1;
  const contradictionAgreement = contradictionMetrics?.agreementScore ?? 1;
  const contradictionDisagreement = contradictionMetrics?.contradictionScore ?? 0;

  return {
    crossModalConsistency: modalityConsistency * contradictionConsistency,
    crossModalConfidence: modalityConfidence * contradictionAgreement,
    crossModalDisagreement: Math.max(modalityDisagreement, contradictionDisagreement),
  };
}

function computeParticipantCrossModalMetrics(
  participantId: string,
  items: readonly ClassifiedEvidenceItem[],
  eventsById: ReadonlyMap<string, EvidenceEvent>,
  evaluatedAt: Date,
  contradictionMetrics: ParticipantContradictionMetrics | null,
  halfLifeMs: number,
): ParticipantCrossModalMetrics {
  const modalities = [
    assessFace(items, eventsById, evaluatedAt, halfLifeMs),
    assessSpeaker(items, eventsById, evaluatedAt, halfLifeMs),
    assessMetadata(items, eventsById, evaluatedAt, halfLifeMs),
    assessTranscript(items, eventsById, evaluatedAt, halfLifeMs),
  ];

  return {
    participantId,
    modalities,
    ...modalityScores(modalities, contradictionMetrics),
  };
}

/**
 * Compares face, speaker, metadata, and transcript identity stances per
 * participant hypothesis. Reuses decay-weighted contradiction metrics as a
 * secondary consistency signal — never recomputes fusion or contradiction math.
 */
export function computeSessionCrossModalMetrics(
  classification: SessionEvidenceClassification,
  eventsById: ReadonlyMap<string, EvidenceEvent>,
  contradictionMetrics: SessionContradictionMetrics,
  options: CrossModalConsistencyOptions = {},
): SessionCrossModalMetrics {
  const halfLifeMs = options.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;

  return {
    sessionId: classification.sessionId,
    evaluatedAt: classification.evaluatedAt,
    byParticipant: classification.byParticipant.map((participant) => {
      const contradictionRow =
        contradictionMetrics.byParticipant.find(
          (row) => row.participantId === participant.participantId,
        ) ?? null;
      return computeParticipantCrossModalMetrics(
        participant.participantId,
        participant.items,
        eventsById,
        classification.evaluatedAt,
        contradictionRow,
        halfLifeMs,
      );
    }),
  };
}

/** Internal ranking influence — posterior math stays untouched. */
export function crossModalSelectionScore(
  probability: number,
  metrics: ParticipantCrossModalMetrics,
): number {
  return probability * metrics.crossModalConsistency * (1 - metrics.crossModalDisagreement * 0.5);
}
