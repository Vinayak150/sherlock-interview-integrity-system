import type { NewEvidenceEvent } from '@sherlock/contracts';
import { describe, expect, it } from 'vitest';

import { extractContradictionSignal } from './changePointSignal.js';

const OCCURRED_AT = new Date('2026-07-10T12:00:00.000Z');

function event(overrides: Partial<NewEvidenceEvent> = {}): NewEvidenceEvent {
  return {
    sessionId: 'session-1',
    bundle: 'visual',
    signalName: 'face_embedding_self_consistency',
    healthStatus: 'OK',
    value: { similarity: 0.9, isFirstObservation: false },
    occurredAt: OCCURRED_AT,
    metadata: null,
    ...overrides,
  };
}

describe('extractContradictionSignal', () => {
  it('returns null when no change-point event is present', () => {
    expect(extractContradictionSignal([event()], [])).toBeNull();
  });

  it('returns null when a change-point event is present but not flagged', () => {
    const events = [
      event({
        signalName: 'face_embedding_change_point',
        value: { detected: false, cumulativeDeviation: 0.1 },
      }),
    ];
    expect(extractContradictionSignal(events, [])).toBeNull();
  });

  it('returns an uncorroborated ContradictionSignal when only one bundle change-points', () => {
    const events = [
      event({
        signalName: 'face_embedding_change_point',
        value: { detected: true, cumulativeDeviation: 0.5 },
      }),
    ];
    const signal = extractContradictionSignal(events, []);
    expect(signal).not.toBeNull();
    expect(signal?.bundle).toBe('visual');
    expect(signal?.corroborated).toBe(false);
    expect(signal?.detectedAt).toBe(OCCURRED_AT);
  });

  it('returns a corroborated ContradictionSignal when two bundles change-point', () => {
    const events = [
      event({
        signalName: 'face_embedding_change_point',
        value: { detected: true, cumulativeDeviation: 0.5 },
      }),
      event({
        bundle: 'audio',
        signalName: 'voice_embedding_change_point',
        value: { detected: true, cumulativeDeviation: 0.6 },
      }),
    ];
    const signal = extractContradictionSignal(events, []);
    expect(signal?.corroborated).toBe(true);
  });

  it('ignores a SERVICE_UNAVAILABLE change-point event even if its value looks flagged', () => {
    const events = [
      event({
        signalName: 'face_embedding_change_point',
        healthStatus: 'SERVICE_UNAVAILABLE',
        value: { detected: true, cumulativeDeviation: 0.5 },
      }),
    ];
    expect(extractContradictionSignal(events, [])).toBeNull();
  });

  it('corroborates across the current batch and prior session history', () => {
    const prior = [
      {
        id: 'prior-1',
        sessionId: 'session-1',
        bundle: 'audio' as const,
        signalName: 'voice_embedding_change_point',
        healthStatus: 'OK' as const,
        value: { detected: true, cumulativeDeviation: 0.4 },
        occurredAt: OCCURRED_AT,
        recordedAt: OCCURRED_AT,
        metadata: null,
      },
    ];
    const current = [
      event({
        signalName: 'face_embedding_change_point',
        value: { detected: true, cumulativeDeviation: 0.5 },
      }),
    ];
    expect(extractContradictionSignal(current, prior)?.corroborated).toBe(true);
  });
});
