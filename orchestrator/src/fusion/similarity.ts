/** Cosine similarity between two equal-length embedding vectors — the standard comparison for face/voice embeddings (RFC §4-C/D). Returns a value in `[-1, 1]`. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new RangeError(`vectors must be the same length, received ${a.length} and ${b.length}`);
  }
  if (a.length === 0) {
    throw new RangeError('vectors must not be empty');
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] as number;
    const bi = b[i] as number;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  if (normA === 0 || normB === 0) {
    return 0; // a zero vector has no defined direction; treat as maximally dissimilar rather than throwing.
  }

  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  // Guard against floating-point drift pushing a value like 1.0000000002 outside the valid range.
  return Math.max(-1, Math.min(1, similarity));
}
