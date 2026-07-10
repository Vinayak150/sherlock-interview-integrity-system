/**
 * Expected Calibration Error (Plan M15: "calibration (ECE) metrics as
 * first-class"). Standard binned ECE: partition `[0, 1]` into
 * `binCount` equal-width bins, and within each non-empty bin compute
 * `|mean(predicted) - mean(actual)|`, weighted by that bin's share of
 * all samples. A perfectly calibrated model (predicted probabilities
 * that genuinely match observed outcome frequencies) has `ECE === 0`.
 *
 * This is the tool that would eventually validate whether the
 * hand-set, Phase-1 log-likelihood-ratio magnitudes throughout
 * `fusion/likelihoodRatios.ts` (every one of which is explicitly
 * labeled "judgment, not measurement," per RFC §5's own caveat) are
 * actually well-calibrated once real labeled outcomes exist — RFC §16's
 * "revisit once enough labeled outcomes exist" callback, made concrete.
 */
export interface CalibrationSample {
  readonly predictedProbability: number;
  readonly actualOutcome: boolean;
}

const DEFAULT_BIN_COUNT = 10;

function assertUnitInterval(name: string, value: number): void {
  if (!(value >= 0 && value <= 1)) {
    throw new RangeError(`${name} must be within [0, 1], received ${value}`);
  }
}

export function computeExpectedCalibrationError(
  samples: readonly CalibrationSample[],
  binCount: number = DEFAULT_BIN_COUNT,
): number {
  if (!(binCount >= 1)) {
    throw new RangeError(`binCount must be at least 1, received ${binCount}`);
  }
  if (samples.length === 0) return 0;

  for (const sample of samples) {
    assertUnitInterval('predictedProbability', sample.predictedProbability);
  }

  const bins: { predictedSum: number; actualSum: number; count: number }[] = Array.from(
    { length: binCount },
    () => ({ predictedSum: 0, actualSum: 0, count: 0 }),
  );

  for (const sample of samples) {
    // The top edge (probability === 1) belongs to the last bin, not a nonexistent bin past it.
    const binIndex = Math.min(binCount - 1, Math.floor(sample.predictedProbability * binCount));
    const bin = bins[binIndex] as { predictedSum: number; actualSum: number; count: number };
    bin.predictedSum += sample.predictedProbability;
    bin.actualSum += sample.actualOutcome ? 1 : 0;
    bin.count += 1;
  }

  let ece = 0;
  for (const bin of bins) {
    if (bin.count === 0) continue;
    const meanPredicted = bin.predictedSum / bin.count;
    const meanActual = bin.actualSum / bin.count;
    ece += (bin.count / samples.length) * Math.abs(meanPredicted - meanActual);
  }

  return ece;
}
