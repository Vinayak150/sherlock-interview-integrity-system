import type { EmbeddingSelfConsistencyValue, NewEvidenceEvent } from '@sherlock/contracts';

import type { ChangePointDetector } from '../../fusion/index.js';
import type { ModelServingClient } from '../../modelserving_client/index.js';
import {
  ModelServingNoSpeechError,
  ModelServingUnavailableError,
} from '../../modelserving_client/index.js';
import type { EmbeddingSelfConsistencyTracker } from '../embeddingSelfConsistency.js';
import type { BundleAdapter } from '../types.js';
import { makeEvidenceEvent } from '../types.js';

const AUDIO_SIGNAL_NAMES = ['voice_embedding_self_consistency'] as const;

export interface AudioBundleInput {
  /** Raw audio chunk bytes for this observation window. Never persisted or retained beyond this call (RFC §12/§15) — only the derived signal is. */
  readonly audioPayload: Uint8Array;
}

/**
 * The Audio Bundle Adapter (RFC §4-D; Plan M9): voice-embedding
 * self-consistency, plus the CUSUM change-point check on that stream (RFC
 * §5) — the audio analog of `VisualBundleAdapter`. Deliberately scoped to
 * this one signal for this milestone: synthetic-speech artifact
 * detection, prosody/cadence consistency, ambient/room-tone consistency,
 * double-voice/audio-leakage detection, and speaker-diarization stability
 * (also §4-D) have no model-serving endpoint built for them yet — not
 * implemented rather than fabricated.
 */
export class AudioBundleAdapter implements BundleAdapter<AudioBundleInput> {
  readonly bundle = 'audio' as const;

  constructor(
    private readonly modelServingClient: ModelServingClient,
    private readonly consistencyTracker: EmbeddingSelfConsistencyTracker,
    private readonly changePointDetector: ChangePointDetector,
  ) {}

  async buildEvidenceEvents(
    sessionId: string,
    input: AudioBundleInput,
    occurredAt: Date = new Date(),
  ): Promise<readonly NewEvidenceEvent[]> {
    let embedding: readonly number[];
    try {
      const embeddingResult = await this.modelServingClient.extractVoiceEmbedding(
        sessionId,
        input.audioPayload,
      );
      embedding = embeddingResult.embedding;
    } catch (error) {
      if (error instanceof ModelServingNoSpeechError) {
        return this.buildNoSpeechEvents(sessionId, occurredAt);
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
        signalName: 'voice_embedding_self_consistency',
        healthStatus: consistency.isFirstObservation ? 'NO_SIGNAL_DETECTED' : 'OK',
        value: consistencyValue,
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
          signalName: 'voice_embedding_change_point',
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

  private buildNoSpeechEvents(sessionId: string, occurredAt: Date): NewEvidenceEvent[] {
    const consistencyValue: EmbeddingSelfConsistencyValue = {
      similarity: null,
      isFirstObservation: true,
    };

    return [
      makeEvidenceEvent({
        sessionId,
        bundle: this.bundle,
        signalName: 'voice_embedding_self_consistency',
        healthStatus: 'NO_SIGNAL_DETECTED',
        value: consistencyValue,
        occurredAt,
      }),
    ];
  }

  private buildServiceUnavailableEvents(
    sessionId: string,
    occurredAt: Date,
    reason: string,
  ): NewEvidenceEvent[] {
    return AUDIO_SIGNAL_NAMES.map((signalName) =>
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
