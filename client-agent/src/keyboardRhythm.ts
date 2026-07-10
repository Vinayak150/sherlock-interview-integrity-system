/**
 * Keyboard-rhythm *timing* anomaly detection (RFC §9.5: "keyboard-timing
 * metadata, not keystroke *content*" — this module never sees which keys
 * were pressed, only the millisecond timestamps between keydown events).
 *
 * A simple, explainable heuristic — not a trained model: maintains a
 * running mean/variance of inter-keystroke intervals (Welford's online
 * algorithm, numerically stable) and flags an "anomaly" when a new
 * interval falls outside `anomalyStdDevMultiplier` standard deviations of
 * that running baseline. This deliberately does not attempt to identify
 * *who* is typing — only whether the current rhythm looks statistically
 * different from this session's own established rhythm, which is exactly
 * the RFC's own reference-independent, self-consistency framing (§4-C/D)
 * applied to keyboard timing rather than an embedding.
 */
export interface KeyboardRhythmOptions {
  readonly anomalyStdDevMultiplier?: number;
  readonly minSamplesBeforeDetection?: number;
}

const DEFAULT_ANOMALY_STD_DEV_MULTIPLIER = 3;
const DEFAULT_MIN_SAMPLES_BEFORE_DETECTION = 10;
/** A floor on the effective standard deviation, representing ordinary measurement jitter -- without it, a baseline that happens to be (near-)perfectly uniform would have zero variance and could never flag *any* deviation as an outlier, which is the opposite of what this detector is for. */
const MIN_STD_DEV_MS = 5;

export class KeyboardRhythmDetector {
  private lastKeydownMs: number | null = null;
  private sampleCount = 0;
  private mean = 0;
  private sumSquaredDeviation = 0;
  private readonly anomalyStdDevMultiplier: number;
  private readonly minSamplesBeforeDetection: number;

  constructor(options: KeyboardRhythmOptions = {}) {
    this.anomalyStdDevMultiplier =
      options.anomalyStdDevMultiplier ?? DEFAULT_ANOMALY_STD_DEV_MULTIPLIER;
    this.minSamplesBeforeDetection =
      options.minSamplesBeforeDetection ?? DEFAULT_MIN_SAMPLES_BEFORE_DETECTION;
  }

  /** Records a keydown timestamp and returns whether the interval since the previous keydown is an anomaly relative to this session's own running baseline. Always `false` for the very first keystroke (nothing to compare against) and while still below `minSamplesBeforeDetection`. */
  recordKeydown(atMs: number): boolean {
    if (this.lastKeydownMs === null) {
      this.lastKeydownMs = atMs;
      return false;
    }

    const interval = atMs - this.lastKeydownMs;
    this.lastKeydownMs = atMs;

    const isAnomaly =
      this.sampleCount >= this.minSamplesBeforeDetection && this.isOutlier(interval);

    this.sampleCount += 1;
    const delta = interval - this.mean;
    this.mean += delta / this.sampleCount;
    const delta2 = interval - this.mean;
    this.sumSquaredDeviation += delta * delta2;

    return isAnomaly;
  }

  private isOutlier(interval: number): boolean {
    if (this.sampleCount < 2) return false;
    const variance = this.sumSquaredDeviation / (this.sampleCount - 1);
    const stdDev = Math.max(Math.sqrt(variance), MIN_STD_DEV_MS);
    return Math.abs(interval - this.mean) > this.anomalyStdDevMultiplier * stdDev;
  }
}
