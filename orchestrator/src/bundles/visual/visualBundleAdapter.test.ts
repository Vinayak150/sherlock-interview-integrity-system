import { describe, expect, it } from 'vitest';

import { ChangePointDetector } from '../../fusion/index.js';
import type { ModelServingClient } from '../../modelserving_client/index.js';
import { ModelServingLivenessError, ModelServingNoFaceError, ModelServingUnavailableError } from '../../modelserving_client/index.js';
import { EmbeddingSelfConsistencyTracker } from '../embeddingSelfConsistency.js';
import { VisualBundleAdapter } from './visualBundleAdapter.js';

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
  return new VisualBundleAdapter(
    client,
    new EmbeddingSelfConsistencyTracker(),
    new ChangePointDetector(),
  );
}

describe('VisualBundleAdapter', () => {
  it('reports NO_SIGNAL_DETECTED for both signals when liveness returns NO_FACE_DETECTED', async () => {
    const adapter = buildAdapter(
      fakeClient({
        detectVisualLiveness: async () => {
          throw new ModelServingLivenessError('NO_FACE_DETECTED', 'no face detected in frame');
        },
      }),
    );

    const events = await adapter.buildEvidenceEvents(
      'session-1',
      { framePayload: new Uint8Array([1, 2, 3]) },
      OCCURRED_AT,
    );

    expect(events).toHaveLength(2);
    expect(events.find((e) => e.signalName === 'face_embedding_self_consistency')).toMatchObject({
      healthStatus: 'NO_SIGNAL_DETECTED',
    });
    expect(events.find((e) => e.signalName === 'visual_liveness')).toMatchObject({
      healthStatus: 'NO_SIGNAL_DETECTED',
      value: { score: 0, isLive: false },
    });
  });

  it('reports NO_SIGNAL_DETECTED for self-consistency when model-serving returns NO_FACE', async () => {
    const adapter = buildAdapter(
      fakeClient({
        extractFaceEmbedding: async () => {
          throw new ModelServingNoFaceError('No face detected in frame');
        },
      }),
    );

    const events = await adapter.buildEvidenceEvents(
      'session-1',
      { framePayload: new Uint8Array([1, 2, 3]) },
      OCCURRED_AT,
    );

    const consistency = events.find((e) => e.signalName === 'face_embedding_self_consistency');
    expect(consistency).toMatchObject({ healthStatus: 'NO_SIGNAL_DETECTED' });
    expect(consistency?.value).toMatchObject({ similarity: null, isFirstObservation: true });
    expect(events.find((e) => e.signalName === 'face_embedding_change_point')).toBeUndefined();

    const liveness = events.find((e) => e.signalName === 'visual_liveness');
    expect(liveness).toMatchObject({ healthStatus: 'OK', value: { score: 0.9, isLive: true } });
  });

  it('reports NO_SIGNAL_DETECTED for self-consistency and no change-point event on the first observation', async () => {
    const adapter = buildAdapter(fakeClient());
    const events = await adapter.buildEvidenceEvents(
      'session-1',
      { framePayload: new Uint8Array([1, 2, 3]) },
      OCCURRED_AT,
    );

    const consistency = events.find((e) => e.signalName === 'face_embedding_self_consistency');
    expect(consistency?.healthStatus).toBe('NO_SIGNAL_DETECTED');
    expect(consistency?.value).toMatchObject({ similarity: null, isFirstObservation: true });
    expect(events.find((e) => e.signalName === 'face_embedding_change_point')).toBeUndefined();
  });

  it('reports OK with high similarity and no change-point when the second frame matches the first', async () => {
    const adapter = buildAdapter(fakeClient());
    await adapter.buildEvidenceEvents(
      'session-1',
      { framePayload: new Uint8Array([1]) },
      OCCURRED_AT,
    );
    const events = await adapter.buildEvidenceEvents(
      'session-1',
      { framePayload: new Uint8Array([1]) },
      OCCURRED_AT,
    );

    const consistency = events.find((e) => e.signalName === 'face_embedding_self_consistency');
    expect(consistency).toMatchObject({ healthStatus: 'OK' });
    expect((consistency?.value as { similarity: number }).similarity).toBeCloseTo(1, 5);

    const changePoint = events.find((e) => e.signalName === 'face_embedding_change_point');
    expect(changePoint?.value).toMatchObject({ detected: false });
  });

  it('always reports visual_liveness OK, reflecting the model-serving result', async () => {
    const adapter = buildAdapter(
      fakeClient({
        detectVisualLiveness: async (sessionId) => ({ sessionId, score: 0.2, isLive: false }),
      }),
    );
    const events = await adapter.buildEvidenceEvents(
      'session-1',
      { framePayload: new Uint8Array([1]) },
      OCCURRED_AT,
    );

    const liveness = events.find((e) => e.signalName === 'visual_liveness');
    expect(liveness).toMatchObject({ healthStatus: 'OK', value: { score: 0.2, isLive: false } });
  });

  it('eventually flags a change-point when consecutive embeddings look like a different person', async () => {
    let callCount = 0;
    const adapter = buildAdapter(
      fakeClient({
        extractFaceEmbedding: async (sessionId) => {
          callCount += 1;
          // First call establishes the reference; every call after that looks orthogonal
          // (a plausible mid-call swap), which should eventually cross the CUSUM control limit.
          const embedding = callCount === 1 ? [1, 0, 0] : [0, 1, 0];
          return { sessionId, embedding, dimension: 3 };
        },
      }),
    );

    let flagged = false;
    for (let i = 0; i < 5 && !flagged; i++) {
      const events = await adapter.buildEvidenceEvents(
        'session-1',
        { framePayload: new Uint8Array([1]) },
        OCCURRED_AT,
      );
      const changePoint = events.find((e) => e.signalName === 'face_embedding_change_point');
      flagged = (changePoint?.value as { detected?: boolean } | undefined)?.detected === true;
    }
    expect(flagged).toBe(true);
  });

  it('reports SERVICE_UNAVAILABLE for both signals when model-serving is unreachable', async () => {
    const adapter = buildAdapter(
      fakeClient({
        extractFaceEmbedding: async () => {
          throw new ModelServingUnavailableError('model-serving down');
        },
      }),
    );

    const events = await adapter.buildEvidenceEvents(
      'session-1',
      { framePayload: new Uint8Array([1]) },
      OCCURRED_AT,
    );

    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.healthStatus).toBe('SERVICE_UNAVAILABLE');
    }
  });

  it('propagates an unexpected (non-ModelServingUnavailableError) failure rather than masking it', async () => {
    const adapter = buildAdapter(
      fakeClient({
        extractFaceEmbedding: async () => {
          throw new TypeError('unexpected bug');
        },
      }),
    );

    await expect(
      adapter.buildEvidenceEvents('session-1', { framePayload: new Uint8Array([1]) }, OCCURRED_AT),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('tags every event with the visual bundle and the requested occurredAt', async () => {
    const adapter = buildAdapter(fakeClient());
    const events = await adapter.buildEvidenceEvents(
      'session-1',
      { framePayload: new Uint8Array([1]) },
      OCCURRED_AT,
    );

    for (const event of events) {
      expect(event.bundle).toBe('visual');
      expect(event.sessionId).toBe('session-1');
      expect(event.occurredAt).toBe(OCCURRED_AT);
    }
  });
});
