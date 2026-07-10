import { ModelServingUnavailableError, ModelServingValidationError } from './errors.js';
import type { EmbeddingResult, LivenessResult } from './types.js';

/**
 * The Model-Serving RPC client (RFC §9.2/§9.6: "synchronous/async RPC,
 * no broker" between the Orchestrator and the Model-Serving Layer; Plan
 * M8). Plain HTTP over `fetch` — the RFC names "gRPC or plain HTTP" as
 * equally valid fits and does not mandate either, and a second RPC
 * framework dependency is not justified at this codebase's stated scale
 * (RFC §9.0).
 *
 * Every method throws `ModelServingUnavailableError` on any transport or
 * non-2xx failure — never a fabricated embedding or score. Callers
 * (Visual/Audio Bundle Adapters, M9) are expected to catch exactly this
 * error type and translate it into a `SERVICE_UNAVAILABLE`
 * `EvidenceEvent`, per RFC §13: "Model-serving layer unavailable ->
 * Orchestrator continues on cached/last-known bundle contributions with
 * widened uncertainty; does not crash sessions."
 */

const DEFAULT_TIMEOUT_MS = 5_000;

export interface ModelServingClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export interface ModelServingClient {
  extractFaceEmbedding(sessionId: string, payload: Uint8Array): Promise<EmbeddingResult>;
  extractVoiceEmbedding(sessionId: string, payload: Uint8Array): Promise<EmbeddingResult>;
  detectVisualLiveness(sessionId: string, payload: Uint8Array): Promise<LivenessResult>;
}

interface RawEmbeddingResponse {
  readonly sessionId: string;
  readonly embedding: readonly number[];
  readonly dimension: number;
}

interface RawLivenessResponse {
  readonly sessionId: string;
  readonly score: number;
  readonly isLive: boolean;
}

function isRawEmbeddingResponse(value: unknown): value is RawEmbeddingResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { embedding?: unknown }).embedding) &&
    typeof (value as { dimension?: unknown }).dimension === 'number'
  );
}

function isRawLivenessResponse(value: unknown): value is RawLivenessResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { score?: unknown }).score === 'number' &&
    typeof (value as { isLive?: unknown }).isLive === 'boolean'
  );
}

export class HttpModelServingClient implements ModelServingClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ModelServingClientOptions) {
    if (options.baseUrl.trim() === '') {
      throw new ModelServingValidationError('baseUrl must not be empty');
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async extractFaceEmbedding(sessionId: string, payload: Uint8Array): Promise<EmbeddingResult> {
    const raw = await this.post('/v1/embeddings/face', sessionId, payload);
    if (!isRawEmbeddingResponse(raw)) {
      throw new ModelServingUnavailableError('Malformed embedding response from model-serving');
    }
    return { sessionId: raw.sessionId, embedding: raw.embedding, dimension: raw.dimension };
  }

  async extractVoiceEmbedding(sessionId: string, payload: Uint8Array): Promise<EmbeddingResult> {
    const raw = await this.post('/v1/embeddings/voice', sessionId, payload);
    if (!isRawEmbeddingResponse(raw)) {
      throw new ModelServingUnavailableError('Malformed embedding response from model-serving');
    }
    return { sessionId: raw.sessionId, embedding: raw.embedding, dimension: raw.dimension };
  }

  async detectVisualLiveness(sessionId: string, payload: Uint8Array): Promise<LivenessResult> {
    const raw = await this.post('/v1/liveness/visual', sessionId, payload);
    if (!isRawLivenessResponse(raw)) {
      throw new ModelServingUnavailableError('Malformed liveness response from model-serving');
    }
    return { sessionId: raw.sessionId, score: raw.score, isLive: raw.isLive };
  }

  private async post(path: string, sessionId: string, payload: Uint8Array): Promise<unknown> {
    if (sessionId.trim() === '') {
      throw new ModelServingValidationError('sessionId must not be empty');
    }
    if (payload.length === 0) {
      throw new ModelServingValidationError('payload must not be empty');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, payload: Buffer.from(payload).toString('base64') }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ModelServingUnavailableError(
          `Model-serving responded with status ${response.status} for ${path}`,
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof ModelServingUnavailableError) throw error;
      throw new ModelServingUnavailableError(`Model-serving request to ${path} failed`, error);
    } finally {
      clearTimeout(timeout);
    }
  }
}
