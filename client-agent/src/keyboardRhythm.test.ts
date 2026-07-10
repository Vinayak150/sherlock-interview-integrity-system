import { describe, expect, it } from 'vitest';

import { KeyboardRhythmDetector } from './keyboardRhythm.js';

describe('KeyboardRhythmDetector', () => {
  it('never flags the very first keystroke (nothing to compare against)', () => {
    const detector = new KeyboardRhythmDetector();
    expect(detector.recordKeydown(0)).toBe(false);
  });

  it('does not flag anomalies before minSamplesBeforeDetection is reached', () => {
    const detector = new KeyboardRhythmDetector({ minSamplesBeforeDetection: 20 });
    let anomalyFlagged = false;
    let t = 0;
    for (let i = 0; i < 15; i++) {
      t += 150;
      anomalyFlagged = anomalyFlagged || detector.recordKeydown(t);
    }
    // A single wildly different interval thrown in early should still not be flagged --
    // there are not yet enough samples to have a meaningful baseline.
    t += 5_000;
    expect(detector.recordKeydown(t)).toBe(false);
  });

  it('does not flag a consistent, steady typing rhythm', () => {
    const detector = new KeyboardRhythmDetector({ minSamplesBeforeDetection: 5 });
    let anomalyFlagged = false;
    let t = 0;
    for (let i = 0; i < 30; i++) {
      t += 150; // steady 150ms inter-key interval
      anomalyFlagged = anomalyFlagged || detector.recordKeydown(t);
    }
    expect(anomalyFlagged).toBe(false);
  });

  it('flags a sudden, sustained rhythm change after a steady baseline (e.g. a paste-like burst or a handoff)', () => {
    const detector = new KeyboardRhythmDetector({ minSamplesBeforeDetection: 5 });
    let t = 0;
    for (let i = 0; i < 20; i++) {
      t += 150;
      detector.recordKeydown(t);
    }

    // A single near-instantaneous interval, far outside the established ~150ms rhythm.
    t += 2;
    const flagged = detector.recordKeydown(t);
    expect(flagged).toBe(true);
  });

  it('treats a zero-variance baseline safely (no division by zero / spurious flags)', () => {
    const detector = new KeyboardRhythmDetector({ minSamplesBeforeDetection: 3 });
    let t = 0;
    for (let i = 0; i < 10; i++) {
      t += 100; // perfectly uniform interval -- zero variance
      expect(() => detector.recordKeydown(t)).not.toThrow();
    }
  });
});
