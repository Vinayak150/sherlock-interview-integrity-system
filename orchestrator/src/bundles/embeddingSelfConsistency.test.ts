import { describe, expect, it } from 'vitest';

import { EmbeddingSelfConsistencyTracker } from './embeddingSelfConsistency.js';

describe('EmbeddingSelfConsistencyTracker', () => {
  it('returns similarity: null on the first observation for a session/bundle key', () => {
    const tracker = new EmbeddingSelfConsistencyTracker();
    const result = tracker.observe('session-1', 'visual', [1, 0, 0]);
    expect(result).toEqual({ similarity: null, isFirstObservation: true });
  });

  it('returns similarity close to 1 for a second observation identical to the first', () => {
    const tracker = new EmbeddingSelfConsistencyTracker();
    tracker.observe('session-1', 'visual', [1, 0, 0]);
    const result = tracker.observe('session-1', 'visual', [1, 0, 0]);
    expect(result.isFirstObservation).toBe(false);
    expect(result.similarity).toBeCloseTo(1, 6);
  });

  it('returns a low similarity for a second observation that looks like a different embedding', () => {
    const tracker = new EmbeddingSelfConsistencyTracker();
    tracker.observe('session-1', 'visual', [1, 0, 0]);
    const result = tracker.observe('session-1', 'visual', [0, 1, 0]);
    expect(result.similarity).toBeCloseTo(0, 6);
  });

  it('keeps visual and audio tracked independently for the same session', () => {
    const tracker = new EmbeddingSelfConsistencyTracker();
    tracker.observe('session-1', 'visual', [1, 0, 0]);
    const audioFirst = tracker.observe('session-1', 'audio', [0, 1, 0]);
    expect(audioFirst.isFirstObservation).toBe(true);
  });

  it('keeps sessions fully isolated', () => {
    const tracker = new EmbeddingSelfConsistencyTracker();
    tracker.observe('session-a', 'visual', [1, 0, 0]);
    const sessionB = tracker.observe('session-b', 'visual', [0, 1, 0]);
    expect(sessionB.isFirstObservation).toBe(true);
  });

  it('smooths the running reference across multiple consistent observations', () => {
    const tracker = new EmbeddingSelfConsistencyTracker();
    tracker.observe('session-1', 'visual', [1, 0, 0]);
    tracker.observe('session-1', 'visual', [0.9, 0.1, 0]);
    const third = tracker.observe('session-1', 'visual', [0.95, 0.05, 0]);
    // Still highly self-consistent despite minor per-frame jitter.
    expect(third.similarity).toBeGreaterThan(0.95);
  });

  it('reset() clears the tracked reference, treating the next observation as the first again', () => {
    const tracker = new EmbeddingSelfConsistencyTracker();
    tracker.observe('session-1', 'visual', [1, 0, 0]);
    tracker.reset('session-1', 'visual');
    const result = tracker.observe('session-1', 'visual', [0, 1, 0]);
    expect(result.isFirstObservation).toBe(true);
  });
});
