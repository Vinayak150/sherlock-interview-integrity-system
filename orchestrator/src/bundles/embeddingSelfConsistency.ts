import { cosineSimilarity } from '../fusion/index.js';

/**
 * Shared per-session running-reference tracker for embedding self-
 * consistency (RFC §4-C/D: "face/voice-embedding self-consistency within
 * the session ... needs no external reference at all"), used by both the
 * Visual and Audio Bundle Adapters (M9) — the comparison logic is
 * identical for both signal families; only the embedding source differs.
 *
 * The running reference is a simple incremental mean of every embedding
 * observed so far for a `(sessionId, bundle)` key, not just the first
 * frame — smoothing out a single noisy capture, while still being
 * "reference-independent" in the RFC's sense (nothing outside this
 * session's own stream is consulted).
 */
export interface SelfConsistencyObservation {
  readonly similarity: number | null;
  readonly isFirstObservation: boolean;
}

interface TrackerEntry {
  readonly runningMean: number[];
  readonly observationCount: number;
}

export class EmbeddingSelfConsistencyTracker {
  private readonly entries = new Map<string, TrackerEntry>();

  private key(sessionId: string, bundle: string): string {
    return `${sessionId}:${bundle}`;
  }

  /**
   * Compares `embedding` against the running reference for
   * `(sessionId, bundle)`, then folds it into that reference. Returns
   * `similarity: null` on the very first observation — there is nothing
   * to compare against yet (RFC §7 absence-of-evidence, not a mismatch).
   */
  observe(
    sessionId: string,
    bundle: string,
    embedding: readonly number[],
  ): SelfConsistencyObservation {
    const key = this.key(sessionId, bundle);
    const existing = this.entries.get(key);

    if (existing === undefined) {
      this.entries.set(key, { runningMean: [...embedding], observationCount: 1 });
      return { similarity: null, isFirstObservation: true };
    }

    const similarity = cosineSimilarity(existing.runningMean, embedding);

    const nextCount = existing.observationCount + 1;
    const nextMean = existing.runningMean.map(
      (value, i) => value + ((embedding[i] as number) - value) / nextCount,
    );
    this.entries.set(key, { runningMean: nextMean, observationCount: nextCount });

    return { similarity, isFirstObservation: false };
  }

  reset(sessionId: string, bundle: string): void {
    this.entries.delete(this.key(sessionId, bundle));
  }
}
