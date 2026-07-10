import { describe, expect, it } from 'vitest';

import {
  BUNDLE_NAMES,
  BundleNameSchema,
  CONTRACTS_PACKAGE_NAME,
  EvidenceEventSchema,
  NewEvidenceEventSchema,
  NewSessionStateSnapshotSchema,
  SIGNAL_HEALTH_STATUSES,
  SessionStateSnapshotSchema,
  SignalHealthStatusSchema,
} from './index.js';

describe('@sherlock/contracts package identity', () => {
  it('exposes a package identity marker', () => {
    expect(CONTRACTS_PACKAGE_NAME).toBe('@sherlock/contracts');
  });
});

describe('SignalHealthStatusSchema (RFC §13, ADR-11)', () => {
  it('accepts exactly the three-state signal-health contract', () => {
    expect(SIGNAL_HEALTH_STATUSES).toEqual(['OK', 'NO_SIGNAL_DETECTED', 'SERVICE_UNAVAILABLE']);
    for (const status of SIGNAL_HEALTH_STATUSES) {
      expect(SignalHealthStatusSchema.parse(status)).toBe(status);
    }
  });

  it('rejects a value outside the three-state contract', () => {
    expect(() => SignalHealthStatusSchema.parse('DOWN')).toThrow();
  });
});

describe('BundleNameSchema (RFC §4 signal families)', () => {
  it('accepts every §4 bundle family named in the repository structure (Plan §5)', () => {
    expect(BUNDLE_NAMES).toEqual([
      'claim',
      'metadata',
      'visual',
      'audio',
      'linguistic',
      'device',
      'elicitation',
      'meta',
      'cross_session',
    ]);
    for (const bundle of BUNDLE_NAMES) {
      expect(BundleNameSchema.parse(bundle)).toBe(bundle);
    }
  });

  it('rejects a bundle name that is not one of the defined families', () => {
    expect(() => BundleNameSchema.parse('vision')).toThrow();
  });
});

describe('NewEvidenceEventSchema / EvidenceEventSchema', () => {
  const validNewEvent = {
    sessionId: 'session-123',
    bundle: 'visual' as const,
    signalName: 'face_embedding_self_consistency',
    healthStatus: 'OK' as const,
    value: { similarity: 0.94 },
    occurredAt: new Date('2026-07-10T12:00:00.000Z'),
  };

  it('accepts a well-formed new evidence event and defaults metadata to null', () => {
    const parsed = NewEvidenceEventSchema.parse(validNewEvent);

    expect(parsed.sessionId).toBe('session-123');
    expect(parsed.metadata).toBeNull();
  });

  it('accepts NO_SIGNAL_DETECTED and SERVICE_UNAVAILABLE health statuses with a null value', () => {
    for (const healthStatus of ['NO_SIGNAL_DETECTED', 'SERVICE_UNAVAILABLE'] as const) {
      const parsed = NewEvidenceEventSchema.parse({
        ...validNewEvent,
        healthStatus,
        value: null,
      });
      expect(parsed.healthStatus).toBe(healthStatus);
    }
  });

  it('rejects an empty sessionId', () => {
    expect(() => NewEvidenceEventSchema.parse({ ...validNewEvent, sessionId: '  ' })).toThrow();
  });

  it('rejects an empty signalName', () => {
    expect(() => NewEvidenceEventSchema.parse({ ...validNewEvent, signalName: '' })).toThrow();
  });

  it('rejects an unrecognized bundle name', () => {
    expect(() => NewEvidenceEventSchema.parse({ ...validNewEvent, bundle: 'video' })).toThrow();
  });

  it('rejects an unrecognized signal-health status', () => {
    expect(() =>
      NewEvidenceEventSchema.parse({ ...validNewEvent, healthStatus: 'UNKNOWN' }),
    ).toThrow();
  });

  it('rejects a non-Date occurredAt', () => {
    expect(() =>
      NewEvidenceEventSchema.parse({ ...validNewEvent, occurredAt: '2026-07-10T12:00:00.000Z' }),
    ).toThrow();
  });

  it('extends the new-event shape with id and recordedAt for a persisted EvidenceEvent', () => {
    const persisted = EvidenceEventSchema.parse({
      ...validNewEvent,
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      recordedAt: new Date('2026-07-10T12:00:00.250Z'),
    });

    expect(persisted.id).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
    expect(persisted.recordedAt).toBeInstanceOf(Date);
  });

  it('rejects a persisted EvidenceEvent with a non-UUID id', () => {
    expect(() =>
      EvidenceEventSchema.parse({
        ...validNewEvent,
        id: 'not-a-uuid',
        recordedAt: new Date(),
      }),
    ).toThrow();
  });
});

describe('NewSessionStateSnapshotSchema / SessionStateSnapshotSchema', () => {
  const validNewSnapshot = {
    sessionId: 'session-123',
    sequence: 0,
    state: { logOdds: 0, bundles: {} },
  };

  it('accepts a well-formed new snapshot', () => {
    const parsed = NewSessionStateSnapshotSchema.parse(validNewSnapshot);
    expect(parsed.sequence).toBe(0);
  });

  it('rejects a negative sequence number', () => {
    expect(() =>
      NewSessionStateSnapshotSchema.parse({ ...validNewSnapshot, sequence: -1 }),
    ).toThrow();
  });

  it('rejects a non-integer sequence number', () => {
    expect(() =>
      NewSessionStateSnapshotSchema.parse({ ...validNewSnapshot, sequence: 1.5 }),
    ).toThrow();
  });

  it('rejects an empty sessionId', () => {
    expect(() =>
      NewSessionStateSnapshotSchema.parse({ ...validNewSnapshot, sessionId: '' }),
    ).toThrow();
  });

  it('extends the new-snapshot shape with id and createdAt for a persisted snapshot', () => {
    const persisted = SessionStateSnapshotSchema.parse({
      ...validNewSnapshot,
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      createdAt: new Date('2026-07-10T12:00:00.250Z'),
    });

    expect(persisted.id).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
    expect(persisted.createdAt).toBeInstanceOf(Date);
  });
});
