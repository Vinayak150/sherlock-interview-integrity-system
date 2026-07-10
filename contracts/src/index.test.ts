import { describe, expect, it } from 'vitest';

import {
  AUDIO_SIGNAL_NAMES,
  AudioSignalNameSchema,
  BUNDLE_NAMES,
  BiographicalClaimConsistencyValueSchema,
  BundleNameSchema,
  CLAIM_SIGNAL_NAMES,
  CONTRACTS_PACKAGE_NAME,
  ChangePointValueSchema,
  ClaimMatchValueSchema,
  ClaimPresenceValueSchema,
  ClaimSignalNameSchema,
  DEVICE_SIGNAL_NAMES,
  DeviceEventCountValueSchema,
  DeviceSignalNameSchema,
  ELICITATION_CHALLENGE_TYPES,
  ELICITATION_SIGNAL_NAMES,
  ElicitationChallengeTypeSchema,
  ElicitationResponseValueSchema,
  ElicitationSignalNameSchema,
  EmbeddingSelfConsistencyValueSchema,
  EvidenceEventSchema,
  JOIN_METHODS,
  JoinMethodValueSchema,
  LINGUISTIC_SIGNAL_NAMES,
  LinguisticSignalNameSchema,
  METADATA_SIGNAL_NAMES,
  MetadataConsistencyValueSchema,
  MetadataDetectionValueSchema,
  MetadataSignalNameSchema,
  NewEvidenceEventSchema,
  NewSessionStateSnapshotSchema,
  SCREEN_SHARE_STATES,
  SIGNAL_HEALTH_STATUSES,
  ScreenShareStateValueSchema,
  SessionStateSnapshotSchema,
  SignalHealthStatusSchema,
  VISUAL_SIGNAL_NAMES,
  VisualLivenessValueSchema,
  VisualSignalNameSchema,
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

describe('Claim bundle payload schemas (RFC §4-A, Plan M2)', () => {
  it('names exactly the six §4-A claim signals', () => {
    expect(CLAIM_SIGNAL_NAMES).toEqual([
      'display_name_match',
      'email_domain_match',
      'calendar_invite_match',
      'reference_photo_available',
      'prior_id_verification_available',
      'account_history_available',
    ]);
    for (const signalName of CLAIM_SIGNAL_NAMES) {
      expect(ClaimSignalNameSchema.parse(signalName)).toBe(signalName);
    }
  });

  it('rejects an unrecognized claim signal name', () => {
    expect(() => ClaimSignalNameSchema.parse('face_match')).toThrow();
  });

  it('accepts a matched ClaimMatchValue', () => {
    const parsed = ClaimMatchValueSchema.parse({
      matched: true,
      observedValue: 'jane@example.com',
      claimedValue: 'jane@example.com',
    });
    expect(parsed.matched).toBe(true);
  });

  it('accepts a ClaimMatchValue with null observed/claimed values (nothing to compare)', () => {
    const parsed = ClaimMatchValueSchema.parse({
      matched: false,
      observedValue: null,
      claimedValue: null,
    });
    expect(parsed.matched).toBe(false);
    expect(parsed.observedValue).toBeNull();
  });

  it('rejects a ClaimMatchValue with a missing matched flag', () => {
    expect(() => ClaimMatchValueSchema.parse({ observedValue: 'a', claimedValue: 'a' })).toThrow();
  });

  it('accepts an available ClaimPresenceValue', () => {
    const parsed = ClaimPresenceValueSchema.parse({ available: true, reference: 'resume-photo-1' });
    expect(parsed.available).toBe(true);
  });

  it('accepts an unavailable ClaimPresenceValue with a null reference', () => {
    const parsed = ClaimPresenceValueSchema.parse({ available: false, reference: null });
    expect(parsed.available).toBe(false);
  });
});

describe('Metadata bundle payload schemas (RFC §4-B, Plan M2)', () => {
  it('names exactly the six §4-B metadata signals', () => {
    expect(METADATA_SIGNAL_NAMES).toEqual([
      'join_method',
      'ip_geolocation_consistency',
      'device_fingerprint_continuity',
      'virtual_capture_device_detected',
      'screen_share_state',
      'multi_monitor_detected',
    ]);
    for (const signalName of METADATA_SIGNAL_NAMES) {
      expect(MetadataSignalNameSchema.parse(signalName)).toBe(signalName);
    }
  });

  it('rejects an unrecognized metadata signal name', () => {
    expect(() => MetadataSignalNameSchema.parse('eye_contact')).toThrow();
  });

  it('accepts every defined join method', () => {
    expect(JOIN_METHODS).toEqual(['direct_invite_link', 'forwarded_link', 'unknown']);
    for (const method of JOIN_METHODS) {
      const parsed = JoinMethodValueSchema.parse({ method, joinOrder: 1 });
      expect(parsed.method).toBe(method);
    }
  });

  it('accepts a JoinMethodValue with a null joinOrder', () => {
    const parsed = JoinMethodValueSchema.parse({ method: 'unknown', joinOrder: null });
    expect(parsed.joinOrder).toBeNull();
  });

  it('rejects a negative joinOrder', () => {
    expect(() =>
      JoinMethodValueSchema.parse({ method: 'direct_invite_link', joinOrder: -1 }),
    ).toThrow();
  });

  it('accepts a MetadataConsistencyValue with a null consistent flag (nothing to compare)', () => {
    const parsed = MetadataConsistencyValueSchema.parse({
      consistent: null,
      observedValue: 'US',
      statedValue: null,
    });
    expect(parsed.consistent).toBeNull();
  });

  it('accepts a MetadataConsistencyValue with a resolved consistency flag', () => {
    const parsed = MetadataConsistencyValueSchema.parse({
      consistent: false,
      observedValue: 'US',
      statedValue: 'IN',
    });
    expect(parsed.consistent).toBe(false);
  });

  it('accepts a MetadataDetectionValue', () => {
    expect(MetadataDetectionValueSchema.parse({ detected: true }).detected).toBe(true);
    expect(MetadataDetectionValueSchema.parse({ detected: false }).detected).toBe(false);
  });

  it('accepts every defined screen-share state', () => {
    expect(SCREEN_SHARE_STATES).toEqual(['not_sharing', 'sharing_screen', 'sharing_application']);
    for (const state of SCREEN_SHARE_STATES) {
      expect(ScreenShareStateValueSchema.parse({ state }).state).toBe(state);
    }
  });

  it('rejects an unrecognized screen-share state', () => {
    expect(() => ScreenShareStateValueSchema.parse({ state: 'presenting' })).toThrow();
  });
});

describe('Visual bundle payload schemas (RFC §4-C, Plan M9)', () => {
  it('names exactly the visual signals', () => {
    expect(VISUAL_SIGNAL_NAMES).toEqual([
      'face_embedding_self_consistency',
      'visual_liveness',
      'face_embedding_change_point',
    ]);
    for (const signalName of VISUAL_SIGNAL_NAMES) {
      expect(VisualSignalNameSchema.parse(signalName)).toBe(signalName);
    }
  });

  it('accepts EmbeddingSelfConsistencyValue with a null similarity on first observation', () => {
    const parsed = EmbeddingSelfConsistencyValueSchema.parse({
      similarity: null,
      isFirstObservation: true,
    });
    expect(parsed.similarity).toBeNull();
  });

  it('accepts EmbeddingSelfConsistencyValue with a resolved similarity', () => {
    const parsed = EmbeddingSelfConsistencyValueSchema.parse({
      similarity: 0.92,
      isFirstObservation: false,
    });
    expect(parsed.similarity).toBe(0.92);
  });

  it('rejects a similarity outside [-1, 1]', () => {
    expect(() =>
      EmbeddingSelfConsistencyValueSchema.parse({ similarity: 1.5, isFirstObservation: false }),
    ).toThrow();
  });

  it('accepts VisualLivenessValue', () => {
    expect(VisualLivenessValueSchema.parse({ score: 0.8, isLive: true }).isLive).toBe(true);
  });

  it('accepts ChangePointValue', () => {
    const parsed = ChangePointValueSchema.parse({ detected: true, cumulativeDeviation: 0.42 });
    expect(parsed.detected).toBe(true);
  });

  it('rejects a negative cumulativeDeviation', () => {
    expect(() =>
      ChangePointValueSchema.parse({ detected: false, cumulativeDeviation: -1 }),
    ).toThrow();
  });
});

describe('Audio bundle payload schemas (RFC §4-D, Plan M9)', () => {
  it('names exactly the audio signals', () => {
    expect(AUDIO_SIGNAL_NAMES).toEqual([
      'voice_embedding_self_consistency',
      'voice_embedding_change_point',
    ]);
    for (const signalName of AUDIO_SIGNAL_NAMES) {
      expect(AudioSignalNameSchema.parse(signalName)).toBe(signalName);
    }
  });
});

describe('Device/OS bundle payload schemas (RFC §4-F/§9.5, Plan M10, ADR-16)', () => {
  it('names exactly the device signals', () => {
    expect(DEVICE_SIGNAL_NAMES).toEqual([
      'tab_focus_change',
      'application_switch',
      'clipboard_paste',
      'keyboard_rhythm_anomaly',
    ]);
    for (const signalName of DEVICE_SIGNAL_NAMES) {
      expect(DeviceSignalNameSchema.parse(signalName)).toBe(signalName);
    }
  });

  it('accepts DeviceEventCountValue', () => {
    const parsed = DeviceEventCountValueSchema.parse({ count: 3, windowMs: 60_000 });
    expect(parsed.count).toBe(3);
  });

  it('rejects a non-positive windowMs', () => {
    expect(() => DeviceEventCountValueSchema.parse({ count: 0, windowMs: 0 })).toThrow();
  });
});

describe('Linguistic bundle payload schemas (RFC §4-E, Plan M11)', () => {
  it('names exactly the linguistic signals', () => {
    expect(LINGUISTIC_SIGNAL_NAMES).toEqual(['biographical_claim_consistency']);
    for (const signalName of LINGUISTIC_SIGNAL_NAMES) {
      expect(LinguisticSignalNameSchema.parse(signalName)).toBe(signalName);
    }
  });

  it('accepts BiographicalClaimConsistencyValue with a null consistent flag', () => {
    const parsed = BiographicalClaimConsistencyValueSchema.parse({
      consistent: null,
      claimTopic: 'employer',
    });
    expect(parsed.consistent).toBeNull();
  });

  it('rejects an empty claimTopic', () => {
    expect(() =>
      BiographicalClaimConsistencyValueSchema.parse({ consistent: true, claimTopic: '' }),
    ).toThrow();
  });
});

describe('Active-elicitation bundle payload schemas (RFC §4-G, Plan M11)', () => {
  it('names exactly the elicitation signals', () => {
    expect(ELICITATION_SIGNAL_NAMES).toEqual(['active_elicitation_response']);
    for (const signalName of ELICITATION_SIGNAL_NAMES) {
      expect(ElicitationSignalNameSchema.parse(signalName)).toBe(signalName);
    }
  });

  it('accepts every defined challenge type', () => {
    expect(ELICITATION_CHALLENGE_TYPES).toEqual([
      'unscripted_statement',
      'camera_reposition',
      'repeat_phrase',
    ]);
    for (const challengeType of ELICITATION_CHALLENGE_TYPES) {
      expect(ElicitationChallengeTypeSchema.parse(challengeType)).toBe(challengeType);
    }
  });

  it('accepts ElicitationResponseValue with a null satisfied flag (no response yet)', () => {
    const parsed = ElicitationResponseValueSchema.parse({
      challengeType: 'repeat_phrase',
      satisfied: null,
    });
    expect(parsed.satisfied).toBeNull();
  });
});
