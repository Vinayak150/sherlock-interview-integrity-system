import type { CalibrationTrainingSample, IsotonicKnot } from './types.js';
import { clampUnitInterval } from './plattScaling.js';

function assertSortedKnots(knots: readonly IsotonicKnot[]): void {
  for (let index = 1; index < knots.length; index += 1) {
    const previous = knots[index - 1] as IsotonicKnot;
    const current = knots[index] as IsotonicKnot;
    if (current.x < previous.x) {
      throw new RangeError('isotonic knots must be sorted by ascending x');
    }
    if (current.y < previous.y) {
      throw new RangeError('isotonic knots must be monotonically non-decreasing in y');
    }
  }
}

/**
 * Piecewise-linear isotonic mapping. Values below the first knot use the
 * first y; values above the last knot use the last y.
 */
export function applyIsotonicRegression(
  rawProbability: number,
  knots: readonly IsotonicKnot[],
): number {
  if (knots.length === 0) {
    throw new RangeError('isotonic knots must not be empty');
  }
  if (!(rawProbability >= 0 && rawProbability <= 1)) {
    throw new RangeError(`probability must be within [0, 1], received ${rawProbability}`);
  }

  assertSortedKnots(knots);

  if (rawProbability === 0) {
    return knots[0]!.y;
  }
  const last = knots[knots.length - 1] as IsotonicKnot;
  if (rawProbability === 1) {
    return last.y;
  }

  const x = clampUnitInterval(rawProbability);

  if (x <= knots[0]!.x) {
    return knots[0]!.y;
  }
  if (x >= last.x) {
    return last.y;
  }

  for (let index = 1; index < knots.length; index += 1) {
    const left = knots[index - 1] as IsotonicKnot;
    const right = knots[index] as IsotonicKnot;
    if (x > right.x) {
      continue;
    }
    if (right.x === left.x) {
      return right.y;
    }
    const weight = (x - left.x) / (right.x - left.x);
    return left.y + weight * (right.y - left.y);
  }

  return last.y;
}

/**
 * Pool-adjacent-violators isotonic regression fit for offline training.
 * Returns sorted knots suitable for `applyIsotonicRegression`.
 */
export function fitIsotonicRegression(
  samples: readonly CalibrationTrainingSample[],
): readonly IsotonicKnot[] {
  if (samples.length === 0) {
    return [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  }

  const sorted = [...samples].sort((a, b) => a.rawProbability - b.rawProbability);
  const blocks: { xSum: number; ySum: number; count: number }[] = sorted.map((sample) => ({
    xSum: clampUnitInterval(sample.rawProbability),
    ySum: sample.actualOutcome ? 1 : 0,
    count: 1,
  }));

  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index] as { xSum: number; ySum: number; count: number };
    const averageY = block.ySum / block.count;
    if (index > 0) {
      const previous = blocks[index - 1] as { xSum: number; ySum: number; count: number };
      const previousAverage = previous.ySum / previous.count;
      if (averageY < previousAverage) {
        previous.xSum += block.xSum;
        previous.ySum += block.ySum;
        previous.count += block.count;
        blocks.splice(index, 1);
        index = Math.max(0, index - 1);
        continue;
      }
    }
    index += 1;
  }

  return blocks.map((block) => ({
    x: block.xSum / block.count,
    y: block.ySum / block.count,
  }));
}
