import type { NewEvidenceEvent } from '@sherlock/contracts';

import type { SessionContradictionMetrics } from '../candidateConfidence/contradictionMetrics.js';
import type { SessionCrossModalMetrics } from '../candidateConfidence/crossModalConsistency.js';
import type { FusionPosterior } from '../fusion/index.js';
import { confidenceBucket, modalityConfidenceBucket } from './confidenceBuckets.js';
import {
  METRIC_CONFIDENCE_DISTRIBUTION,
  METRIC_CONTRADICTION_FREQUENCY,
  METRIC_CROSS_MODAL_AGREEMENT,
  METRIC_FACE_CONFIDENCE_DISTRIBUTION,
  METRIC_SPEAKER_CONFIDENCE_DISTRIBUTION,
  METRIC_SPOOF_DETECTION_RATE,
} from './metricNames.js';
import type { AiMetricRecord } from './types.js';

export interface SessionMetricsInput {
  readonly sessionId: string;
  readonly evaluatedAt: Date;
  readonly posterior: FusionPosterior;
  readonly contradictionMetrics: SessionContradictionMetrics;
  readonly crossModalMetrics: SessionCrossModalMetrics;
  readonly tickEvents: readonly NewEvidenceEvent[];
  readonly topParticipantId: string | null;
}

function metricRecord(
  metricName: string,
  metricType: AiMetricRecord['metricType'],
  value: number | boolean,
  labels: AiMetricRecord['labels'],
  observedAt: Date,
): AiMetricRecord {
  return {
    schemaVersion: '1',
    metricName,
    metricType,
    value,
    labels,
    observedAt: observedAt.toISOString(),
  };
}

function modalityConfidence(
  crossModalMetrics: SessionCrossModalMetrics,
  participantId: string | null,
  modality: 'face' | 'speaker',
): number | null {
  if (participantId === null) {
    return null;
  }

  const participant = crossModalMetrics.byParticipant.find(
    (row) => row.participantId === participantId,
  );
  if (participant === undefined) {
    return null;
  }

  const assessment = participant.modalities.find((row) => row.modality === modality);
  return assessment?.confidence ?? null;
}

function spoofDetectedInTick(events: readonly NewEvidenceEvent[]): boolean | null {
  const livenessEvents = events.filter((event) => event.signalName === 'visual_liveness');
  if (livenessEvents.length === 0) {
    return null;
  }

  return livenessEvents.some((event) => {
    if (event.healthStatus !== 'OK') {
      return false;
    }
    const value = event.value as { isLive?: boolean } | null;
    return value?.isLive === false;
  });
}

export function buildSessionMetrics(input: SessionMetricsInput): readonly AiMetricRecord[] {
  const observedAt = input.evaluatedAt;
  const labels = { sessionId: input.sessionId, layer: 'orchestrator' };
  const metrics: AiMetricRecord[] = [];

  const effectiveConfidence = input.posterior.probability;
  const rawConfidence = input.posterior.rawProbability ?? input.posterior.probability;

  metrics.push(
    metricRecord(
      METRIC_CONFIDENCE_DISTRIBUTION,
      'counter',
      1,
      {
        ...labels,
        bucket: confidenceBucket(effectiveConfidence),
        confidenceKind: 'effective',
      },
      observedAt,
    ),
    metricRecord(
      METRIC_CONFIDENCE_DISTRIBUTION,
      'counter',
      1,
      {
        ...labels,
        bucket: confidenceBucket(rawConfidence),
        confidenceKind: 'raw',
      },
      observedAt,
    ),
  );

  const topParticipant =
    input.topParticipantId === null
      ? input.contradictionMetrics.byParticipant[0]
      : input.contradictionMetrics.byParticipant.find(
          (row) => row.participantId === input.topParticipantId,
        );

  const contradictionCount = topParticipant?.contradictions.length ?? 0;
  metrics.push(
    metricRecord(
      METRIC_CONTRADICTION_FREQUENCY,
      'gauge',
      contradictionCount,
      {
        ...labels,
        participantId: topParticipant?.participantId ?? 'unknown',
      },
      observedAt,
    ),
    metricRecord(
      METRIC_CONTRADICTION_FREQUENCY,
      'counter',
      contradictionCount > 0 ? 1 : 0,
      {
        ...labels,
        participantId: topParticipant?.participantId ?? 'unknown',
        signal: 'has_contradiction',
      },
      observedAt,
    ),
  );

  const topCrossModal =
    input.topParticipantId === null
      ? input.crossModalMetrics.byParticipant[0]
      : input.crossModalMetrics.byParticipant.find(
          (row) => row.participantId === input.topParticipantId,
        );

  if (topCrossModal !== undefined) {
    metrics.push(
      metricRecord(
        METRIC_CROSS_MODAL_AGREEMENT,
        'gauge',
        topCrossModal.crossModalConsistency,
        {
          ...labels,
          participantId: topCrossModal.participantId,
        },
        observedAt,
      ),
    );
  }

  const spoofDetected = spoofDetectedInTick(input.tickEvents);
  if (spoofDetected !== null) {
    metrics.push(
      metricRecord(
        METRIC_SPOOF_DETECTION_RATE,
        'counter',
        spoofDetected ? 1 : 0,
        {
          ...labels,
          signal: 'visual_liveness',
        },
        observedAt,
      ),
    );
  }

  const faceConfidence = modalityConfidence(
    input.crossModalMetrics,
    input.topParticipantId,
    'face',
  );
  if (faceConfidence !== null) {
    metrics.push(
      metricRecord(
        METRIC_FACE_CONFIDENCE_DISTRIBUTION,
        'counter',
        1,
        {
          ...labels,
          bucket: modalityConfidenceBucket(faceConfidence),
          participantId: input.topParticipantId ?? 'unknown',
        },
        observedAt,
      ),
    );
  }

  const speakerConfidence = modalityConfidence(
    input.crossModalMetrics,
    input.topParticipantId,
    'speaker',
  );
  if (speakerConfidence !== null) {
    metrics.push(
      metricRecord(
        METRIC_SPEAKER_CONFIDENCE_DISTRIBUTION,
        'counter',
        1,
        {
          ...labels,
          bucket: modalityConfidenceBucket(speakerConfidence),
          participantId: input.topParticipantId ?? 'unknown',
        },
        observedAt,
      ),
    );
  }

  return metrics;
}
