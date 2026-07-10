import { describe, expect, it } from 'vitest';

import type { LifecycleSessionRecord } from '../statemachine/index.js';
import {
  LifecycleSnapshotCodecError,
  deserializeLifecycleSessionRecord,
  serializeLifecycleSessionRecord,
} from './lifecycleSnapshotCodec.js';

const T0 = new Date('2026-07-10T12:00:00.000Z');

describe('lifecycleSnapshotCodec', () => {
  it('round-trips a record with no recovery annotations', () => {
    const record: LifecycleSessionRecord = {
      state: 'LIKELY_CANDIDATE',
      stateEnteredAt: T0,
      recoveryAnnotations: [],
      disqualificationAnnotations: [],
    };

    const serialized = serializeLifecycleSessionRecord(record);
    const restored = deserializeLifecycleSessionRecord(serialized);

    expect(restored.state).toBe('LIKELY_CANDIDATE');
    expect(restored.stateEnteredAt.getTime()).toBe(T0.getTime());
    expect(restored.recoveryAnnotations).toHaveLength(0);
  });

  it('round-trips a record with recovery annotations, preserving them exactly', () => {
    const record: LifecycleSessionRecord = {
      state: 'RECOVERED',
      stateEnteredAt: T0,
      recoveryAnnotations: [{ recoveredAt: T0, regressedFromState: 'LOST_CONFIDENCE' }],
      disqualificationAnnotations: [],
    };

    const restored = deserializeLifecycleSessionRecord(serializeLifecycleSessionRecord(record));

    expect(restored.recoveryAnnotations).toHaveLength(1);
    expect(restored.recoveryAnnotations[0]?.regressedFromState).toBe('LOST_CONFIDENCE');
    expect(restored.recoveryAnnotations[0]?.recoveredAt.getTime()).toBe(T0.getTime());
  });

  it('serializes dates as ISO strings (JSON-safe)', () => {
    const record: LifecycleSessionRecord = {
      state: 'UNKNOWN',
      stateEnteredAt: T0,
      recoveryAnnotations: [],
      disqualificationAnnotations: [],
    };
    const serialized = serializeLifecycleSessionRecord(record);

    expect(serialized.stateEnteredAt).toBe(T0.toISOString());
    // Round-trips through real JSON, not just object identity.
    const throughJson = JSON.parse(JSON.stringify(serialized));
    expect(deserializeLifecycleSessionRecord(throughJson).state).toBe('UNKNOWN');
  });

  it('rejects an unrecognized lifecycle state', () => {
    expect(() =>
      deserializeLifecycleSessionRecord({
        state: 'NOT_A_REAL_STATE',
        stateEnteredAt: T0.toISOString(),
        recoveryAnnotations: [],
      disqualificationAnnotations: [],
      }),
    ).toThrow(LifecycleSnapshotCodecError);
  });

  it('rejects a missing stateEnteredAt', () => {
    expect(() =>
      deserializeLifecycleSessionRecord({ state: 'UNKNOWN', recoveryAnnotations: [] }),
    ).toThrow(LifecycleSnapshotCodecError);
  });

  it('rejects a malformed recovery annotation', () => {
    expect(() =>
      deserializeLifecycleSessionRecord({
        state: 'RECOVERED',
        stateEnteredAt: T0.toISOString(),
        recoveryAnnotations: [{ recoveredAt: T0.toISOString() }],
      }),
    ).toThrow(LifecycleSnapshotCodecError);
  });
});
