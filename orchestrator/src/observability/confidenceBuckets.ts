export function confidenceBucket(probability: number): string {
  if (!(probability >= 0 && probability <= 1)) {
    throw new RangeError(`probability must be within [0, 1], received ${probability}`);
  }
  if (probability < 0.2) return '0.0-0.2';
  if (probability < 0.4) return '0.2-0.4';
  if (probability < 0.6) return '0.4-0.6';
  if (probability < 0.8) return '0.6-0.8';
  return '0.8-1.0';
}

export function modalityConfidenceBucket(confidence: number): string {
  return confidenceBucket(confidence);
}
