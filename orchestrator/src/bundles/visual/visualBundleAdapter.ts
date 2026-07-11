import type {
  EmbeddingSelfConsistencyValue,
  NewEvidenceEvent,
  VisualLivenessValue,
} from '@sherlock/contracts';

import type { ChangePointDetector } from '../../fusion/index.js';
import type { ModelServingClient } from '../../modelserving_client/index.js';
import {
  ModelServingLivenessError,
  ModelServingNoFaceError,
  ModelServingUnavailableError,
} from '../../modelserving_client/index.js';
import type { EmbeddingSelfConsistencyTracker } from '../embeddingSelfConsistency.js';
import type { BundleAdapter } from '../types.js';
import { makeEvidenceEvent } from '../types.js';

const VISUAL_SIGNAL_NAMES = ['face_embedding_self_consistency', 'visual_liveness'] as const;

export interface VisualBundleInput {
  /** Raw frame bytes for this observation window. Never persisted or retained beyond this call (RFC §12/§15) — only the derived signal is. */
  readonly framePayload: Uint8Array;
}

/**
 * The Visual Bundle Adapter (RFC §4-C; Plan M9): face-embedding
 * self-consistency ("strong, reference-independent") and visual liveness,
 * plus the CUSUM change-point check on the self-consistency stream (RFC
 * §5).
 *
 * Model-serving unavailability maps to `SERVICE_UNAVAILABLE`. A frame with no
 * detectable face maps to `NO_SIGNAL_DETECTED` via `ModelServingNoFaceError`
 * (RFC §13: distinct from infra outage).
 */
export class VisualBundleAdapter implements BundleAdapter<VisualBundleInput> {
  readonly bundle = 'visual' as const;

  constructor(
    private readonly modelServingClient: ModelServingClient,
    private readonly consistencyTracker: EmbeddingSelfConsistencyTracker,
    private readonly changePointDetector: ChangePointDetector,
  ) {}

  async buildEvidenceEvents(
    sessionId: string,
    input: VisualBundleInput,
    occurredAt: Date = new Date(),
  ): Promise<readonly NewEvidenceEvent[]> {
    let embedding: readonly number[] | null = null;
    let liveness: { readonly score: number; readonly isLive: boolean };

    try {
      const livenessResult = await this.modelServingClient.detectVisualLiveness(
        sessionId,
        input.framePayload,
      );
      liveness = livenessResult;
    } catch (error) {
      if (error instanceof ModelServingLivenessError) {
        return this.buildNoFaceEvents(sessionId, occurredAt, null);
      }
      if (error instanceof ModelServingUnavailableError) {
        return this.buildServiceUnavailableEvents(sessionId, occurredAt, error.message);
      }
      throw error;
    }

    try {
      const embeddingResult = await this.modelServingClient.extractFaceEmbedding(
        sessionId,
        input.framePayload,
      );
      embedding = embeddingResult.embedding;
    } catch (error) {
      if (error instanceof ModelServingNoFaceError) {
        return this.buildNoFaceEvents(sessionId, occurredAt, liveness);
      }
      if (error instanceof ModelServingUnavailableError) {
        return this.buildServiceUnavailableEvents(sessionId, occurredAt, error.message);
      }
      throw error;
    }

    const consistency = this.consistencyTracker.observe(sessionId, this.bundle, embedding);
    const consistencyValue: EmbeddingSelfConsistencyValue = {
      similarity: consistency.similarity,
      isFirstObservation: consistency.isFirstObservation,
    };

    const events: NewEvidenceEvent[] = [
      makeEvidenceEvent({
        sessionId,
        bundle: this.bundle,
        signalName: 'face_embedding_self_consistency',
        healthStatus: consistency.isFirstObservation ? 'NO_SIGNAL_DETECTED' : 'OK',
        value: consistencyValue,
        occurredAt,
      }),
      makeEvidenceEvent({
        sessionId,
        bundle: this.bundle,
        signalName: 'visual_liveness',
        healthStatus: 'OK',
        value: { score: liveness.score, isLive: liveness.isLive } satisfies VisualLivenessValue,
        occurredAt,
      }),
    ];

    if (!consistency.isFirstObservation && consistency.similarity !== null) {
      const changePoint = this.changePointDetector.observe(
        sessionId,
        this.bundle,
        consistency.similarity,
      );
      events.push(
        makeEvidenceEvent({
          sessionId,
          bundle: this.bundle,
          signalName: 'face_embedding_change_point',
          healthStatus: 'OK',
          value: {
            detected: changePoint.changePointDetected,
            cumulativeDeviation: changePoint.state.cumulativeDeviation,
          },
          occurredAt,
        }),
      );
    }

    return events;
  }

  private buildNoFaceEvents(
    sessionId: string,
    occurredAt: Date,
    liveness: { readonly score: number; readonly isLive: boolean } | null,
  ): NewEvidenceEvent[] {
    const consistencyValue: EmbeddingSelfConsistencyValue = {
      similarity: null,
      isFirstObservation: true,
    };

    const events: NewEvidenceEvent[] = [
      makeEvidenceEvent({
        sessionId,
        bundle: this.bundle,
        signalName: 'face_embedding_self_consistency',
        healthStatus: 'NO_SIGNAL_DETECTED',
        value: consistencyValue,
        occurredAt,
      }),
    ];

    if (liveness === null) {
      events.push(
        makeEvidenceEvent({
          sessionId,
          bundle: this.bundle,
          signalName: 'visual_liveness',
          healthStatus: 'NO_SIGNAL_DETECTED',
          value: { score: 0, isLive: false } satisfies VisualLivenessValue,
          occurredAt,
        }),
      );
      return events;
    }

    events.push(
      makeEvidenceEvent({
        sessionId,
        bundle: this.bundle,
        signalName: 'visual_liveness',
        healthStatus: 'OK',
        value: { score: liveness.score, isLive: liveness.isLive } satisfies VisualLivenessValue,
        occurredAt,
      }),
    );
    return events;
  }

  private buildServiceUnavailableEvents(
    sessionId: string,
    occurredAt: Date,
    reason: string,
  ): NewEvidenceEvent[] {
    return VISUAL_SIGNAL_NAMES.map((signalName) =>
      makeEvidenceEvent({
        sessionId,
        bundle: this.bundle,
        signalName,
        healthStatus: 'SERVICE_UNAVAILABLE',
        value: { reason },
        occurredAt,
      }),
    );
  }
}
