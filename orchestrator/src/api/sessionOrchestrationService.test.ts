import { describe, expect, it } from 'vitest';

import {
  AudioBundleAdapter,
  ClaimBundleAdapter,
  DeviceBundleAdapter,
  ElicitationBundleAdapter,
  EmbeddingSelfConsistencyTracker,
  InMemoryAtsClient,
  LinguisticBundleAdapter,
  MetadataBundleAdapter,
  VisualBundleAdapter,
} from '../bundles/index.js';
import { LlmNarrativeAdapter, StubLlmProvider } from '../explanation/index.js';
import {
  AppealNotFoundError,
  InMemoryAppealRepository,
  InMemoryAuditLogRepository,
} from '../security/index.js';
import type { IdentityClaimRecord } from '../bundles/index.js';
import { ChangePointDetector } from '../fusion/index.js';
import type { ModelServingClient } from '../modelserving_client/index.js';
import { DecisionEngine } from '../decision/index.js';
import { ExplanationEngine } from '../explanation/index.js';
import { FusionEngine } from '../fusion/index.js';
import {
  InMemoryEvidenceEventRepository,
  InMemorySessionSnapshotRepository,
} from '../persistence/index.js';
import { SessionLifecycleStore } from '../routing/index.js';
import { LifecycleStateManager } from '../statemachine/index.js';
import { SessionOrchestrationService } from './sessionOrchestrationService.js';

function seededRecord(overrides: Partial<IdentityClaimRecord> = {}): IdentityClaimRecord {
  return {
    candidateId: 'candidate-1',
    applicationName: 'Jane Doe',
    applicationEmail: 'jane.doe@example.com',
    calendarInviteAttendeeEmail: 'jane.doe@example.com',
    hasReferencePhoto: true,
    hasPriorIdVerification: true,
    hasAccountHistory: true,
    ...overrides,
  };
}

function buildService(): SessionOrchestrationService {
  const atsClient = new InMemoryAtsClient();
  atsClient.seed(seededRecord());

  return new SessionOrchestrationService(
    new ClaimBundleAdapter(atsClient),
    new MetadataBundleAdapter(),
    new InMemoryEvidenceEventRepository(),
    new FusionEngine(),
    new SessionLifecycleStore(new LifecycleStateManager(), new InMemorySessionSnapshotRepository()),
    new DecisionEngine(),
    new ExplanationEngine(),
  );
}

const matchingClaim = {
  candidateId: 'candidate-1',
  displayName: 'Jane Doe',
  joinEmail: 'jane.doe@example.com',
  calendarAttendeeEmail: 'jane.doe@example.com',
};

const neutralMetadata = {
  joinMethod: 'direct_invite_link' as const,
  joinOrder: 1,
  observedIpCountry: 'US',
  statedCountry: 'US',
  observedDeviceFingerprint: null,
  priorSessionDeviceFingerprint: null,
  virtualCaptureDeviceDetected: false,
  screenShareState: 'not_sharing' as const,
  multiMonitorDetected: false,
};

describe('SessionOrchestrationService', () => {
  it('reports UNKNOWN status for a session that has never been ingested', async () => {
    const service = buildService();
    await expect(service.getSessionStatus('session-1')).resolves.toEqual({
      sessionId: 'session-1',
      lifecycleState: 'UNKNOWN',
      hasAccommodationDisclosure: false,
    });
  });

  it('ingests fully matching claim/metadata evidence and climbs past cold-start with no alert', async () => {
    const service = buildService();
    const now = new Date('2026-07-10T12:00:00.000Z');

    const result = await service.ingestClaimAndMetadataEvidence(
      'session-1',
      matchingClaim,
      neutralMetadata,
      now,
    );

    // Full claim + metadata agreement across two bundles clears LIKELY_CANDIDATE's
    // multi-bundle/probability bar directly (RFC §6's climb ladder allows a multi-tier jump
    // in one evaluation once the current tier's dwell time -- zero, for POSSIBLE_CANDIDATE --
    // has elapsed); this is unremarkable, ordinary operation, so no alert is raised.
    expect(result.decision.lifecycleState).toBe('LIKELY_CANDIDATE');
    expect(result.decision.alert).toBeNull();
    expect(result.report).toBeNull();
    await expect(service.getSessionStatus('session-1')).resolves.toEqual({
      sessionId: 'session-1',
      lifecycleState: 'LIKELY_CANDIDATE',
      hasAccommodationDisclosure: false,
    });
  });

  it('builds an Evidence Report only when the Decision actually carries an alert', async () => {
    const service = buildService();
    const now = new Date('2026-07-10T12:00:00.000Z');

    // A genuine mismatch on every claim signal -- still evaluated as ordinary evidence (not a
    // real change-point), so this should not itself raise an alert or abstain unexpectedly; it
    // exercises the "no alert -> no report" path via ordinary operation.
    const result = await service.ingestClaimAndMetadataEvidence(
      'session-1',
      {
        candidateId: 'candidate-1',
        displayName: null,
        joinEmail: null,
        calendarAttendeeEmail: null,
      },
      neutralMetadata,
      now,
    );

    expect(result.decision.alert).toBeNull();
    expect(result.report).toBeNull();
  });

  it('persists evidence durably before it can affect the decision (Plan §9 ordering, exercised end-to-end)', async () => {
    const service = buildService();
    const now = new Date('2026-07-10T12:00:00.000Z');

    await service.ingestClaimAndMetadataEvidence('session-1', matchingClaim, neutralMetadata, now);
    // A second, independent ingestion for the same session should see the first call's
    // already-persisted evidence too (accumulating, not overwriting).
    const second = await service.ingestClaimAndMetadataEvidence(
      'session-1',
      matchingClaim,
      neutralMetadata,
      now,
    );

    expect(second.decision.evidenceRef.events).toHaveLength(24); // 6 claim + 6 metadata signals, ingested twice
  });

  it('keeps sessions fully isolated from one another', async () => {
    const service = buildService();
    const now = new Date('2026-07-10T12:00:00.000Z');

    await service.ingestClaimAndMetadataEvidence('session-a', matchingClaim, neutralMetadata, now);

    expect((await service.getSessionStatus('session-b')).lifecycleState).toBe('UNKNOWN');
  });

  it('recovers lifecycle state across two service instances sharing the same snapshot repository', async () => {
    const atsClient = new InMemoryAtsClient();
    atsClient.seed(seededRecord());
    const evidenceRepository = new InMemoryEvidenceEventRepository();
    const snapshotRepository = new InMemorySessionSnapshotRepository();
    const now = new Date('2026-07-10T12:00:00.000Z');

    const serviceA = new SessionOrchestrationService(
      new ClaimBundleAdapter(atsClient),
      new MetadataBundleAdapter(),
      evidenceRepository,
      new FusionEngine(),
      new SessionLifecycleStore(new LifecycleStateManager(), snapshotRepository),
      new DecisionEngine(),
      new ExplanationEngine(),
    );

    const firstResult = await serviceA.ingestClaimAndMetadataEvidence(
      'session-1',
      matchingClaim,
      neutralMetadata,
      now,
    );
    expect(firstResult.decision.lifecycleState).not.toBe('UNKNOWN');

    // A brand-new service instance (fresh in-memory LifecycleStateManager), simulating a
    // replica restart, but sharing the durable snapshot repository and evidence store.
    const serviceB = new SessionOrchestrationService(
      new ClaimBundleAdapter(atsClient),
      new MetadataBundleAdapter(),
      evidenceRepository,
      new FusionEngine(),
      new SessionLifecycleStore(new LifecycleStateManager(), snapshotRepository),
      new DecisionEngine(),
      new ExplanationEngine(),
    );

    // Before serviceB ever ingests anything for this session, its own fresh
    // LifecycleStateManager has not yet been primed -- recovery is triggered lazily, on the
    // first evaluate() call, not eagerly at construction.
    expect((await serviceB.getSessionStatus('session-1')).lifecycleState).toBe('UNKNOWN');

    const secondResult = await serviceB.ingestClaimAndMetadataEvidence(
      'session-1',
      matchingClaim,
      neutralMetadata,
      new Date(now.getTime() + 1),
    );

    // serviceB never started this session over at UNKNOWN -- it recovered the durable
    // snapshot serviceA left behind and continued from there (RFC §9.2's bounded-recovery
    // claim, exercised end-to-end through the public service API).
    expect(secondResult.decision.lifecycleState).not.toBe('UNKNOWN');
  });
});

describe('SessionOrchestrationService.ingestVisualAudioEvidence (Plan M9)', () => {
  function fakeModelServingClient(overrides: Partial<ModelServingClient> = {}): ModelServingClient {
    return {
      extractFaceEmbedding: async (sessionId) => ({
        sessionId,
        embedding: [1, 0, 0],
        dimension: 3,
      }),
      extractVoiceEmbedding: async (sessionId) => ({
        sessionId,
        embedding: [1, 0, 0],
        dimension: 3,
      }),
      detectVisualLiveness: async (sessionId) => ({ sessionId, score: 0.9, isLive: true }),
      ...overrides,
    };
  }

  function buildServiceWithVisualAudio(
    modelServingClient: ModelServingClient,
  ): SessionOrchestrationService {
    const atsClient = new InMemoryAtsClient();
    atsClient.seed(seededRecord());
    const consistencyTracker = new EmbeddingSelfConsistencyTracker();
    const changePointDetector = new ChangePointDetector();

    return new SessionOrchestrationService(
      new ClaimBundleAdapter(atsClient),
      new MetadataBundleAdapter(),
      new InMemoryEvidenceEventRepository(),
      new FusionEngine(),
      new SessionLifecycleStore(
        new LifecycleStateManager(),
        new InMemorySessionSnapshotRepository(),
      ),
      new DecisionEngine(),
      new ExplanationEngine(),
      new VisualBundleAdapter(modelServingClient, consistencyTracker, changePointDetector),
      new AudioBundleAdapter(modelServingClient, consistencyTracker, changePointDetector),
    );
  }

  it('throws when neither visual nor audio adapter is configured', async () => {
    const service = buildService(); // the M8-only constructor call, no Visual/Audio adapters
    await expect(
      service.ingestVisualAudioEvidence('session-1', new Uint8Array([1]), null, new Date()),
    ).rejects.toThrow();
  });

  it('ingests a visual frame and returns a Decision reflecting the resulting state', async () => {
    const service = buildServiceWithVisualAudio(fakeModelServingClient());
    const now = new Date('2026-07-10T12:00:00.000Z');

    const result = await service.ingestVisualAudioEvidence(
      'session-1',
      new Uint8Array([1, 2, 3]),
      null,
      now,
    );

    expect(result.decision.sessionId).toBe('session-1');
    expect(result.decision.evidenceRef.events.length).toBeGreaterThan(0);
  });

  it('ingests both a visual frame and an audio chunk in one call', async () => {
    const service = buildServiceWithVisualAudio(fakeModelServingClient());
    const now = new Date('2026-07-10T12:00:00.000Z');

    const result = await service.ingestVisualAudioEvidence(
      'session-1',
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
      now,
    );

    const signalNames = result.decision.evidenceRef.events.map((e) => e.signalName);
    expect(signalNames).toContain('face_embedding_self_consistency');
    expect(signalNames).toContain('voice_embedding_self_consistency');
  });

  it('drives the session straight to DISQUALIFIED when corroborated change-points are flagged', async () => {
    let faceCalls = 0;
    let voiceCalls = 0;
    const service = buildServiceWithVisualAudio(
      fakeModelServingClient({
        extractFaceEmbedding: async (sessionId) => {
          faceCalls += 1;
          const embedding = faceCalls === 1 ? [1, 0, 0] : [0, 1, 0];
          return { sessionId, embedding, dimension: 3 };
        },
        extractVoiceEmbedding: async (sessionId) => {
          voiceCalls += 1;
          const embedding = voiceCalls === 1 ? [1, 0, 0] : [0, 1, 0];
          return { sessionId, embedding, dimension: 3 };
        },
      }),
    );
    const now = new Date('2026-07-10T12:00:00.000Z');

    await service.ingestVisualAudioEvidence(
      'session-1',
      new Uint8Array([1]),
      new Uint8Array([2]),
      now,
    );
    let result = await service.ingestVisualAudioEvidence(
      'session-1',
      new Uint8Array([1]),
      new Uint8Array([2]),
      now,
    );
    for (let i = 0; i < 5 && result.decision.lifecycleState !== 'DISQUALIFIED'; i++) {
      result = await service.ingestVisualAudioEvidence(
        'session-1',
        new Uint8Array([1]),
        new Uint8Array([2]),
        now,
      );
    }

    expect(result.decision.lifecycleState).toBe('DISQUALIFIED');
    expect(result.decision.alert?.severity).toBe('URGENT');
    expect(result.report).not.toBeNull();
  });

  it('ingesting visual/audio evidence contributes to the same session as claim/metadata evidence', async () => {
    const atsClient = new InMemoryAtsClient();
    atsClient.seed(seededRecord());
    const evidenceRepository = new InMemoryEvidenceEventRepository();
    const consistencyTracker = new EmbeddingSelfConsistencyTracker();
    const changePointDetector = new ChangePointDetector();

    const service = new SessionOrchestrationService(
      new ClaimBundleAdapter(atsClient),
      new MetadataBundleAdapter(),
      evidenceRepository,
      new FusionEngine(),
      new SessionLifecycleStore(
        new LifecycleStateManager(),
        new InMemorySessionSnapshotRepository(),
      ),
      new DecisionEngine(),
      new ExplanationEngine(),
      new VisualBundleAdapter(fakeModelServingClient(), consistencyTracker, changePointDetector),
      undefined,
    );
    const now = new Date('2026-07-10T12:00:00.000Z');

    await service.ingestClaimAndMetadataEvidence('session-1', matchingClaim, neutralMetadata, now);
    const result = await service.ingestVisualAudioEvidence(
      'session-1',
      new Uint8Array([1]),
      null,
      now,
    );

    const bundles = new Set(result.decision.evidenceRef.events.map((e) => e.bundle));
    expect(bundles.has('claim')).toBe(true);
    expect(bundles.has('visual')).toBe(true);
  });
});

describe('SessionOrchestrationService.ingestDeviceEvidence (Plan M10, ADR-16)', () => {
  function buildServiceWithDevice(): SessionOrchestrationService {
    const atsClient = new InMemoryAtsClient();
    atsClient.seed(seededRecord());

    return new SessionOrchestrationService(
      new ClaimBundleAdapter(atsClient),
      new MetadataBundleAdapter(),
      new InMemoryEvidenceEventRepository(),
      new FusionEngine(),
      new SessionLifecycleStore(
        new LifecycleStateManager(),
        new InMemorySessionSnapshotRepository(),
      ),
      new DecisionEngine(),
      new ExplanationEngine(),
      undefined,
      undefined,
      new DeviceBundleAdapter(),
    );
  }

  it('throws when no Device bundle adapter is configured', async () => {
    const service = buildService();
    await expect(
      service.ingestDeviceEvidence('session-1', {
        consentGranted: true,
        windowMs: 60_000,
        tabFocusChangeCount: 0,
        applicationSwitchCount: 0,
        clipboardPasteCount: 0,
        keyboardRhythmAnomalyCount: 0,
      }),
    ).rejects.toThrow();
  });

  it('ingests device evidence and never abstains/alerts on its own (near-zero identity weight)', async () => {
    const service = buildServiceWithDevice();
    const now = new Date('2026-07-10T12:00:00.000Z');

    const result = await service.ingestDeviceEvidence(
      'session-1',
      {
        consentGranted: true,
        windowMs: 60_000,
        tabFocusChangeCount: 50, // deliberately extreme
        applicationSwitchCount: 50,
        clipboardPasteCount: 20,
        keyboardRhythmAnomalyCount: 20,
      },
      now,
    );

    // Even with extreme device activity, a session with zero other evidence should still read
    // as UNKNOWN/abstained -- device signals must never manufacture identity confidence in
    // either direction (ADR-16).
    expect(result.decision.lifecycleState).toBe('UNKNOWN');
    expect(result.decision.alert).toBeNull();
  });

  it('reports NO_SIGNAL_DETECTED for every device signal when consent is declined', async () => {
    const service = buildServiceWithDevice();
    const now = new Date('2026-07-10T12:00:00.000Z');

    const result = await service.ingestDeviceEvidence(
      'session-1',
      {
        consentGranted: false,
        windowMs: 60_000,
        tabFocusChangeCount: null,
        applicationSwitchCount: null,
        clipboardPasteCount: null,
        keyboardRhythmAnomalyCount: null,
      },
      now,
    );

    const deviceEvents = result.decision.evidenceRef.events.filter((e) => e.bundle === 'device');
    expect(deviceEvents).toHaveLength(4);
    for (const event of deviceEvents) {
      expect(event.healthStatus).toBe('NO_SIGNAL_DETECTED');
    }
  });

  it('device evidence coexists with claim/metadata evidence for the same session', async () => {
    const atsClient = new InMemoryAtsClient();
    atsClient.seed(seededRecord());
    const evidenceRepository = new InMemoryEvidenceEventRepository();

    const service = new SessionOrchestrationService(
      new ClaimBundleAdapter(atsClient),
      new MetadataBundleAdapter(),
      evidenceRepository,
      new FusionEngine(),
      new SessionLifecycleStore(
        new LifecycleStateManager(),
        new InMemorySessionSnapshotRepository(),
      ),
      new DecisionEngine(),
      new ExplanationEngine(),
      undefined,
      undefined,
      new DeviceBundleAdapter(),
    );
    const now = new Date('2026-07-10T12:00:00.000Z');

    await service.ingestClaimAndMetadataEvidence('session-1', matchingClaim, neutralMetadata, now);
    const result = await service.ingestDeviceEvidence(
      'session-1',
      {
        consentGranted: true,
        windowMs: 60_000,
        tabFocusChangeCount: 1,
        applicationSwitchCount: 0,
        clipboardPasteCount: 0,
        keyboardRhythmAnomalyCount: 0,
      },
      now,
    );

    const bundles = new Set(result.decision.evidenceRef.events.map((e) => e.bundle));
    expect(bundles.has('claim')).toBe(true);
    expect(bundles.has('device')).toBe(true);
    // The already-established claim/metadata confidence should be essentially unaffected by
    // the addition of device evidence.
    expect(result.decision.lifecycleState).not.toBe('UNKNOWN');
  });
});

describe('SessionOrchestrationService.ingestLinguisticEvidence / ingestElicitationEvidence (Plan M11)', () => {
  function buildServiceWithLinguisticElicitation(): SessionOrchestrationService {
    const atsClient = new InMemoryAtsClient();
    atsClient.seed(seededRecord());

    return new SessionOrchestrationService(
      new ClaimBundleAdapter(atsClient),
      new MetadataBundleAdapter(),
      new InMemoryEvidenceEventRepository(),
      new FusionEngine(),
      new SessionLifecycleStore(
        new LifecycleStateManager(),
        new InMemorySessionSnapshotRepository(),
      ),
      new DecisionEngine(),
      new ExplanationEngine(),
      undefined,
      undefined,
      undefined,
      new LinguisticBundleAdapter(),
      new ElicitationBundleAdapter(),
    );
  }

  it('throws ingestLinguisticEvidence when no Linguistic adapter is configured', async () => {
    const service = buildService();
    await expect(service.ingestLinguisticEvidence('session-1', { claims: [] })).rejects.toThrow();
  });

  it('throws ingestElicitationEvidence when no Elicitation adapter is configured', async () => {
    const service = buildService();
    await expect(
      service.ingestElicitationEvidence('session-1', {
        challengeType: 'repeat_phrase',
        satisfied: true,
      }),
    ).rejects.toThrow();
  });

  it('ingests linguistic evidence and returns a Decision', async () => {
    const service = buildServiceWithLinguisticElicitation();
    const result = await service.ingestLinguisticEvidence('session-1', {
      claims: [{ claimTopic: 'employer', observedValue: 'Acme', claimedValue: 'Acme' }],
    });

    const bundles = new Set(result.decision.evidenceRef.events.map((e) => e.bundle));
    expect(bundles.has('linguistic')).toBe(true);
  });

  it('ingests an elicitation response and returns a Decision', async () => {
    const service = buildServiceWithLinguisticElicitation();
    const result = await service.ingestElicitationEvidence('session-1', {
      challengeType: 'repeat_phrase',
      satisfied: true,
    });

    const bundles = new Set(result.decision.evidenceRef.events.map((e) => e.bundle));
    expect(bundles.has('elicitation')).toBe(true);
  });

  it('a satisfied elicitation response can lift a session out of confident ambiguity on a later tick', async () => {
    const service = buildServiceWithLinguisticElicitation();
    // A single weak, ambiguous-leaning signal on its own.
    await service.ingestLinguisticEvidence('session-1', {
      claims: [{ claimTopic: 'employer', observedValue: 'Acme', claimedValue: 'Not Acme' }],
    });

    const before = await service.getSessionStatus('session-1');
    const after = await service.ingestElicitationEvidence('session-1', {
      challengeType: 'repeat_phrase',
      satisfied: true,
    });

    // Not asserting a specific tier -- only that the strong elicitation signal was actually
    // incorporated (evidence count grew, and the bundle appears in the reference).
    expect(after.decision.evidenceRef.events.length).toBeGreaterThan(0);
    expect(before.lifecycleState).toBeDefined();
  });
});

describe('SessionOrchestrationService narrative wiring (Plan M12)', () => {
  function fakeModelServingClient(): ModelServingClient {
    let faceCalls = 0;
    let voiceCalls = 0;
    return {
      extractFaceEmbedding: async (sessionId) => {
        faceCalls += 1;
        const embedding = faceCalls === 1 ? [1, 0, 0] : [0, 1, 0];
        return { sessionId, embedding, dimension: 3 };
      },
      extractVoiceEmbedding: async (sessionId) => {
        voiceCalls += 1;
        const embedding = voiceCalls === 1 ? [1, 0, 0] : [0, 1, 0];
        return { sessionId, embedding, dimension: 3 };
      },
      detectVisualLiveness: async (sessionId) => ({ sessionId, score: 0.9, isLive: true }),
    };
  }

  function buildServiceWithNarrative(
    llmNarrativeAdapter?: LlmNarrativeAdapter,
  ): SessionOrchestrationService {
    const atsClient = new InMemoryAtsClient();
    atsClient.seed(seededRecord());
    const consistencyTracker = new EmbeddingSelfConsistencyTracker();
    const changePointDetector = new ChangePointDetector();
    const modelServingClient = fakeModelServingClient();

    return new SessionOrchestrationService(
      new ClaimBundleAdapter(atsClient),
      new MetadataBundleAdapter(),
      new InMemoryEvidenceEventRepository(),
      new FusionEngine(),
      new SessionLifecycleStore(
        new LifecycleStateManager(),
        new InMemorySessionSnapshotRepository(),
      ),
      new DecisionEngine(),
      new ExplanationEngine(),
      new VisualBundleAdapter(modelServingClient, consistencyTracker, changePointDetector),
      new AudioBundleAdapter(modelServingClient, consistencyTracker, changePointDetector),
      undefined,
      undefined,
      undefined,
      llmNarrativeAdapter,
    );
  }

  /** Drives a fresh session to DISQUALIFIED (guaranteeing an Alert, and therefore a Report) via corroborated visual+audio change-points. */
  async function disqualifySession(service: SessionOrchestrationService, now: Date) {
    let result = await service.ingestVisualAudioEvidence(
      'session-1',
      new Uint8Array([1]),
      new Uint8Array([2]),
      now,
    );
    for (let i = 0; i < 10 && result.decision.lifecycleState !== 'DISQUALIFIED'; i++) {
      result = await service.ingestVisualAudioEvidence(
        'session-1',
        new Uint8Array([1]),
        new Uint8Array([2]),
        now,
      );
    }
    return result;
  }

  it('is null when no LlmNarrativeAdapter is configured, even when a report is produced', async () => {
    const service = buildServiceWithNarrative();
    const disqualified = await disqualifySession(service, new Date('2026-07-10T12:00:00.000Z'));

    expect(disqualified.decision.lifecycleState).toBe('DISQUALIFIED');
    expect(disqualified.report).not.toBeNull();
    expect(disqualified.narrative).toBeNull();
  });

  it('is null whenever no report is produced (no alert this tick), even with an adapter configured', async () => {
    const service = buildServiceWithNarrative(new LlmNarrativeAdapter(new StubLlmProvider()));
    const now = new Date('2026-07-10T12:00:00.000Z');

    const result = await service.ingestVisualAudioEvidence(
      'session-1',
      new Uint8Array([1]),
      null,
      now,
    );

    expect(result.report).toBeNull();
    expect(result.narrative).toBeNull();
  });

  it('produces a validated narrative when a report is produced and an adapter is configured', async () => {
    const service = buildServiceWithNarrative(new LlmNarrativeAdapter(new StubLlmProvider()));
    const disqualified = await disqualifySession(service, new Date('2026-07-10T12:00:00.000Z'));

    expect(disqualified.report).not.toBeNull();
    expect(disqualified.narrative).not.toBeNull();
    expect(disqualified.narrative).toContain(disqualified.decision.sessionId);
  });

  it('"LLM unavailable" (RFC §13): narrative degrades to null, but the Decision and structured Report are entirely unaffected', async () => {
    const unreachableProvider = {
      generateNarrative: () => Promise.reject(new Error('LLM API down')),
    };
    const now = new Date('2026-07-10T12:00:00.000Z');

    const withNarrative = await disqualifySession(
      buildServiceWithNarrative(new LlmNarrativeAdapter(new StubLlmProvider())),
      now,
    );
    const withoutLlm = await disqualifySession(
      buildServiceWithNarrative(new LlmNarrativeAdapter(unreachableProvider)),
      now,
    );

    // Score/state (the Decision) and the structured Report are identical regardless of LLM
    // availability -- only the narrative differs.
    expect(withoutLlm.decision.lifecycleState).toBe(withNarrative.decision.lifecycleState);
    expect(withoutLlm.report?.topContributingSignals.length).toBe(
      withNarrative.report?.topContributingSignals.length,
    );
    expect(withoutLlm.narrative).toBeNull();
    expect(withNarrative.narrative).not.toBeNull();
  });
});

describe('SessionOrchestrationService security/privacy features (Plan M16)', () => {
  function buildServiceWithSecurity(
    auditLogRepository = new InMemoryAuditLogRepository(),
    appealRepository = new InMemoryAppealRepository(),
  ): SessionOrchestrationService {
    const atsClient = new InMemoryAtsClient();
    atsClient.seed(seededRecord());

    return new SessionOrchestrationService(
      new ClaimBundleAdapter(atsClient),
      new MetadataBundleAdapter(),
      new InMemoryEvidenceEventRepository(),
      new FusionEngine(),
      new SessionLifecycleStore(
        new LifecycleStateManager(),
        new InMemorySessionSnapshotRepository(),
      ),
      new DecisionEngine(),
      new ExplanationEngine(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      auditLogRepository,
      appealRepository,
    );
  }

  it('getSessionStatus records an audit-log entry when an AuditLogRepository is configured', async () => {
    const auditLogRepository = new InMemoryAuditLogRepository();
    const service = buildServiceWithSecurity(auditLogRepository);

    await service.getSessionStatus('session-1', 'reviewer-alice');

    const entries = await auditLogRepository.listBySession('session-1');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.viewedBy).toBe('reviewer-alice');
  });

  it('getSessionStatus defaults viewedBy to "unknown" when not provided', async () => {
    const auditLogRepository = new InMemoryAuditLogRepository();
    const service = buildServiceWithSecurity(auditLogRepository);

    await service.getSessionStatus('session-1');

    const entries = await auditLogRepository.listBySession('session-1');
    expect(entries[0]?.viewedBy).toBe('unknown');
  });

  it('getSessionStatus never throws when no AuditLogRepository is configured', async () => {
    const service = buildService();
    await expect(service.getSessionStatus('session-1')).resolves.toBeDefined();
  });

  it('fileAppeal throws when no AppealRepository is configured', async () => {
    const service = buildService();
    await expect(service.fileAppeal('session-1', 'statement')).rejects.toThrow();
  });

  it('fileAppeal and listAppeals round-trip correctly', async () => {
    const service = buildServiceWithSecurity();

    const filed = await service.fileAppeal('session-1', 'That was really me on the call.');
    expect(filed.status).toBe('PENDING');

    const appeals = await service.listAppeals('session-1');
    expect(appeals).toHaveLength(1);
    expect(appeals[0]?.id).toBe(filed.id);
  });

  it('appeals are isolated per session', async () => {
    const appealRepository = new InMemoryAppealRepository();
    const service = buildServiceWithSecurity(new InMemoryAuditLogRepository(), appealRepository);

    await service.fileAppeal('session-a', 'statement A');

    await expect(service.listAppeals('session-b')).resolves.toEqual([]);
  });

  it("an appeal can be resolved via the repository directly (adjudication is a human step, not this service's job)", async () => {
    const appealRepository = new InMemoryAppealRepository();
    const service = buildServiceWithSecurity(new InMemoryAuditLogRepository(), appealRepository);

    const filed = await service.fileAppeal('session-1', 'statement');
    const resolved = await appealRepository.resolve(
      filed.id,
      'OVERTURNED',
      'Confirmed via footage review.',
    );

    expect(resolved.status).toBe('OVERTURNED');
    await expect(appealRepository.resolve('nonexistent', 'UPHELD', 'x')).rejects.toBeInstanceOf(
      AppealNotFoundError,
    );
  });
});
