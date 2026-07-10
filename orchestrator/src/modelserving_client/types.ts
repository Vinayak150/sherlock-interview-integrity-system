export interface EmbeddingResult {
  readonly sessionId: string;
  readonly embedding: readonly number[];
  readonly dimension: number;
}

export interface LivenessResult {
  readonly sessionId: string;
  readonly score: number;
  readonly isLive: boolean;
}
