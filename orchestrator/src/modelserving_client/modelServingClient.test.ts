import { describe, expect, it, vi } from 'vitest';

import { ModelServingLivenessError, ModelServingNoFaceError, ModelServingUnavailableError, ModelServingValidationError } from './errors.js';
import { HttpModelServingClient } from './modelServingClient.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('HttpModelServingClient', () => {
  it('rejects an empty baseUrl at construction', () => {
    expect(() => new HttpModelServingClient({ baseUrl: '' })).toThrow(ModelServingValidationError);
  });

  it('extractFaceEmbedding posts to /v1/embeddings/face and returns the parsed result', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ sessionId: 'session-1', embedding: [0.1, 0.2, 0.3], dimension: 3 }),
      );
    const client = new HttpModelServingClient({
      baseUrl: 'http://model-serving.internal',
      fetchImpl,
    });

    const result = await client.extractFaceEmbedding('session-1', new Uint8Array([1, 2, 3]));

    expect(result).toEqual({ sessionId: 'session-1', embedding: [0.1, 0.2, 0.3], dimension: 3 });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://model-serving.internal/v1/embeddings/face',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('extractVoiceEmbedding posts to /v1/embeddings/voice', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ sessionId: 'session-1', embedding: [0.5], dimension: 1 }));
    const client = new HttpModelServingClient({
      baseUrl: 'http://model-serving.internal',
      fetchImpl,
    });

    await client.extractVoiceEmbedding('session-1', new Uint8Array([9]));

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://model-serving.internal/v1/embeddings/voice',
      expect.anything(),
    );
  });

  it('detectVisualLiveness posts to /v1/liveness/visual and returns the parsed result', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ sessionId: 'session-1', score: 0.92, isLive: true }));
    const client = new HttpModelServingClient({
      baseUrl: 'http://model-serving.internal',
      fetchImpl,
    });

    const result = await client.detectVisualLiveness('session-1', new Uint8Array([1]));

    expect(result).toEqual({ sessionId: 'session-1', score: 0.92, isLive: true });
  });

  it('base64-encodes the payload in the request body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ sessionId: 's', embedding: [], dimension: 0 }));
    const client = new HttpModelServingClient({ baseUrl: 'http://x', fetchImpl });

    await client.extractFaceEmbedding('s', new Uint8Array([104, 105])); // "hi"

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ sessionId: 's', payload: Buffer.from('hi').toString('base64') });
  });

  it('throws ModelServingLivenessError when model-serving returns a liveness NO_FACE_DETECTED error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          detail: {
            error: 'NO_FACE_DETECTED',
            sessionId: 'session-1',
            message: 'no face detected in frame',
          },
        },
        false,
        404,
      ),
    );
    const client = new HttpModelServingClient({ baseUrl: 'http://x', fetchImpl });

    await expect(
      client.detectVisualLiveness('session-1', new Uint8Array([1])),
    ).rejects.toBeInstanceOf(ModelServingLivenessError);
  });

  it('throws ModelServingNoFaceError when model-serving returns a NO_FACE 404', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          detail: {
            error: 'NO_FACE',
            sessionId: 'session-1',
            message: 'No face detected in frame',
          },
        },
        false,
        404,
      ),
    );
    const client = new HttpModelServingClient({ baseUrl: 'http://x', fetchImpl });

    await expect(
      client.extractFaceEmbedding('session-1', new Uint8Array([1])),
    ).rejects.toBeInstanceOf(ModelServingNoFaceError);
  });

  it('throws ModelServingUnavailableError on a non-2xx response, never returning a fabricated result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 503));
    const client = new HttpModelServingClient({ baseUrl: 'http://x', fetchImpl });

    await expect(
      client.extractFaceEmbedding('session-1', new Uint8Array([1])),
    ).rejects.toBeInstanceOf(ModelServingUnavailableError);
  });

  it('throws ModelServingUnavailableError when the transport itself fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new HttpModelServingClient({ baseUrl: 'http://x', fetchImpl });

    await expect(
      client.extractFaceEmbedding('session-1', new Uint8Array([1])),
    ).rejects.toBeInstanceOf(ModelServingUnavailableError);
  });

  it('throws ModelServingUnavailableError on a malformed embedding response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ not: 'the expected shape' }));
    const client = new HttpModelServingClient({ baseUrl: 'http://x', fetchImpl });

    await expect(
      client.extractFaceEmbedding('session-1', new Uint8Array([1])),
    ).rejects.toBeInstanceOf(ModelServingUnavailableError);
  });

  it('rejects an empty sessionId without calling fetch', async () => {
    const fetchImpl = vi.fn();
    const client = new HttpModelServingClient({ baseUrl: 'http://x', fetchImpl });

    await expect(client.extractFaceEmbedding('', new Uint8Array([1]))).rejects.toBeInstanceOf(
      ModelServingValidationError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an empty payload without calling fetch', async () => {
    const fetchImpl = vi.fn();
    const client = new HttpModelServingClient({ baseUrl: 'http://x', fetchImpl });

    await expect(
      client.extractFaceEmbedding('session-1', new Uint8Array([])),
    ).rejects.toBeInstanceOf(ModelServingValidationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('aborts and rejects with ModelServingUnavailableError when the request exceeds the configured timeout', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const client = new HttpModelServingClient({
      baseUrl: 'http://x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
    });

    await expect(
      client.extractFaceEmbedding('session-1', new Uint8Array([1])),
    ).rejects.toBeInstanceOf(ModelServingUnavailableError);
  });
});
