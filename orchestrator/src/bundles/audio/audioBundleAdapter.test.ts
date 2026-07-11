import { describe, expect, it } from 'vitest';

import { ChangePointDetector } from '../../fusion/index.js';
import type { ModelServingClient } from '../../modelserving_client/index.js';
import { ModelServingNoSpeechError, ModelServingUnavailableError } from '../../modelserving_client/index.js';
import { EmbeddingSelfConsistencyTracker } from '../embeddingSelfConsistency.js';
import { AudioBundleAdapter } from './audioBundleAdapter.js';

const OCCURRED_AT = new Date('2026-07-10T12:00:00.000Z');

function fakeClient(overrides: Partial<ModelServingClient> = {}): ModelServingClient {
  return {
    extractFaceEmbedding: async (sessionId) => ({ sessionId, embedding: [1, 0, 0], dimension: 3 }),
    extractVoiceEmbedding: async (sessionId) => ({ sessionId, embedding: [1, 0, 0], dimension: 3 }),
    detectVisualLiveness: async (sessionId) => ({ sessionId, score: 0.9, isLive: true }),
    ...overrides,
  };
}

function buildAdapter(client: ModelServingClient) {
  return new AudioBundleAdapter(
    client,
    new EmbeddingSelfConsistencyTracker(),
    new ChangePointDetector(),
  );
}

describe('AudioBundleAdapter', () => {
  it('reports NO_SIGNAL_DETECTED on the first observation, with no change-point event', async () => {
    const adapter = buildAdapter(fakeClient());
    const events = await adapter.buildEvidenceEvents(
      'session-1',
      { audioPayload: new Uint8Array([1]) },
      OCCURRED_AT,
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      signalName: 'voice_embedding_self_consistency',
      healthStatus: 'NO_SIGNAL_DETECTED',
      value: { similarity: null, isFirstObservation: true },
    });
  });

  it('reports OK plus a change-point check on the second observation', async () => {
    const adapter = buildAdapter(fakeClient());
    await adapter.buildEvidenceEvents(
      'session-1',
      { audioPayload: new Uint8Array([1]) },
      OCCURRED_AT,
    );
    const events = await adapter.buildEvidenceEvents(
      'session-1',
      { audioPayload: new Uint8Array([1]) },
      OCCURRED_AT,
    );

    expect(events).toHaveLength(2);
    const consistency = events.find((e) => e.signalName === 'voice_embedding_self_consistency');
    expect(consistency).toMatchObject({ healthStatus: 'OK' });
    const changePoint = events.find((e) => e.signalName === 'voice_embedding_change_point');
    expect(changePoint?.value).toMatchObject({ detected: false });
  });

  it('reports NO_SIGNAL_DETECTED when model-serving finds no usable speech', async () => {
    const adapter = buildAdapter(
      fakeClient({
        extractVoiceEmbedding: async () => {
          throw new ModelServingNoSpeechError('NO_SPEECH_DETECTED', 'no speech');
        },
      }),
    );

    const events = await adapter.buildEvidenceEvents(
      'session-1',
      { audioPayload: new Uint8Array([1]) },
      OCCURRED_AT,
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      signalName: 'voice_embedding_self_consistency',
      healthStatus: 'NO_SIGNAL_DETECTED',
      value: { similarity: null, isFirstObservation: true },
    });
  });

  it('reports SERVICE_UNAVAILABLE when model-serving is unreachable', async () => {
    const adapter = buildAdapter(
      fakeClient({
        extractVoiceEmbedding: async () => {
          throw new ModelServingUnavailableError('model-serving down');
        },
      }),
    );

    const events = await adapter.buildEvidenceEvents(
      'session-1',
      { audioPayload: new Uint8Array([1]) },
      OCCURRED_AT,
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.healthStatus).toBe('SERVICE_UNAVAILABLE');
  });

  it('eventually flags a change-point on a sustained voice-embedding shift', async () => {
    let callCount = 0;
    const adapter = buildAdapter(
      fakeClient({
        extractVoiceEmbedding: async (sessionId) => {
          callCount += 1;
          const embedding = callCount === 1 ? [1, 0, 0] : [0, 1, 0];
          return { sessionId, embedding, dimension: 3 };
        },
      }),
    );

    let flagged = false;
    for (let i = 0; i < 5 && !flagged; i++) {
      const events = await adapter.buildEvidenceEvents(
        'session-1',
        { audioPayload: new Uint8Array([1]) },
        OCCURRED_AT,
      );
      const changePoint = events.find((e) => e.signalName === 'voice_embedding_change_point');
      flagged = (changePoint?.value as { detected?: boolean } | undefined)?.detected === true;
    }
    expect(flagged).toBe(true);
  });

  it('tags every event with the audio bundle', async () => {
    const adapter = buildAdapter(fakeClient());
    const events = await adapter.buildEvidenceEvents(
      'session-1',
      { audioPayload: new Uint8Array([1]) },
      OCCURRED_AT,
    );
    for (const event of events) {
      expect(event.bundle).toBe('audio');
    }
  });
});
