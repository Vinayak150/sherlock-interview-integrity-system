import { describe, expect, it } from 'vitest';

import { SessionOrchestrationService } from './api/index.js';
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
} from './bundles/index.js';
import { DecisionEngine } from './decision/index.js';
import { ExplanationEngine, LlmNarrativeAdapter, StubLlmProvider } from './explanation/index.js';
import { ChangePointDetector, FusionEngine } from './fusion/index.js';
import type { ModelServingClient } from './modelserving_client/index.js';
import {
  InMemoryAccommodationDisclosureRepository,
  InMemoryEvidenceEventRepository,
  InMemorySessionSnapshotRepository,
} from './persistence/index.js';
import { ConsistentHashRing, SessionLifecycleStore } from './routing/index.js';
import {
  EncryptingEvidenceEventRepository,
  InMemoryAppealRepository,
  InMemoryAuditLogRepository,
} from './security/index.js';
import { LifecycleStateManager } from './statemachine/index.js';

/**
 * The final, full-system integration check: one session's evidence flows
 * through every completed milestone's real component -- Evidence
 * ingestion (M2/M9/M10/M11) -> encryption at rest (M16) -> Fusion (M3,
 * clamped per M14) -> the Lifecycle FSM (M4) -> recovery-aware routing
 * (M7) -> the Decision Engine (M5, extended M11) -> the Evidence Report
 * Engine (M6) -> the LLM narrative layer (M12) -> the API/dashboard-
 * facing surfaces (M8/M13) -> the audit/appeal/accommodation layer (M16)
 * -- and a second, independent "replica" recovers the exact same session
 * state purely from the durable snapshot (M7), never re-deriving it from
 * scratch. `ConsistentHashRing` (M7) is exercised directly alongside this
 * flow to prove the routing building block that a real multi-replica
 * load balancer would consult is itself present and correct, even though
 * (per `index.ts`'s own documented decision) it is not wired into this
 * single-replica orchestrator process.
 */
function fakeModelServingClient(): ModelServingClient {
  return {
    extractFaceEmbedding: async (sessionId) => ({ sessionId, embedding: [1, 0, 0], dimension: 3 }),
    extractVoiceEmbedding: async (sessionId) => ({ sessionId, embedding: [1, 0, 0], dimension: 3 }),
    detectVisualLiveness: async (sessionId) => ({ sessionId, score: 0.95, isLive: true }),
  };
}

function buildFullyWiredService(
  evidenceRepository: InMemoryEvidenceEventRepository,
  snapshotRepository: InMemorySessionSnapshotRepository,
  atsClient: InMemoryAtsClient,
  auditLogRepository: InMemoryAuditLogRepository,
): SessionOrchestrationService {
  const consistencyTracker = new EmbeddingSelfConsistencyTracker();
  const changePointDetector = new ChangePointDetector();
  const modelServingClient = fakeModelServingClient();

  return new SessionOrchestrationService(
    new ClaimBundleAdapter(atsClient),
    new MetadataBundleAdapter(),
    new EncryptingEvidenceEventRepository(evidenceRepository, 'integration-test-encryption-key'),
    new FusionEngine(),
    new SessionLifecycleStore(new LifecycleStateManager(), snapshotRepository),
    new DecisionEngine(),
    new ExplanationEngine(),
    new VisualBundleAdapter(modelServingClient, consistencyTracker, changePointDetector),
    new AudioBundleAdapter(modelServingClient, consistencyTracker, changePointDetector),
    new DeviceBundleAdapter(),
    new LinguisticBundleAdapter(),
    new ElicitationBundleAdapter(),
    new LlmNarrativeAdapter(new StubLlmProvider()),
    new InMemoryAccommodationDisclosureRepository(),
    undefined, // SessionEventBus -- exercised separately in api/sessionEventBus.test.ts
    auditLogRepository,
    new InMemoryAppealRepository(),
  );
}

describe('Full system integration: the candidate identification pipeline end to end', () => {
  it('carries evidence from every bundle family through to a coherent, well-formed final Decision', async () => {
    const atsClient = new InMemoryAtsClient();
    atsClient.seed({
      candidateId: 'candidate-1',
      applicationName: 'Jane Doe',
      applicationEmail: 'jane.doe@example.com',
      calendarInviteAttendeeEmail: 'jane.doe@example.com',
      hasReferencePhoto: true,
      hasPriorIdVerification: true,
      hasAccountHistory: true,
    });
    const sharedEvidenceRepository = new InMemoryEvidenceEventRepository();
    const sharedSnapshotRepository = new InMemorySessionSnapshotRepository();
    const auditLogRepository = new InMemoryAuditLogRepository();
    const service = buildFullyWiredService(
      sharedEvidenceRepository,
      sharedSnapshotRepository,
      atsClient,
      auditLogRepository,
    );
    const now = new Date('2026-07-10T12:00:00.000Z');
    const sessionId = 'integration-session-1';

    // 1. Claim + Metadata (M2).
    const claimResult = await service.ingestClaimAndMetadataEvidence(
      sessionId,
      {
        candidateId: 'candidate-1',
        displayName: 'Jane Doe',
        joinEmail: 'jane.doe@example.com',
        calendarAttendeeEmail: 'jane.doe@example.com',
      },
      {
        joinMethod: 'direct_invite_link',
        joinOrder: 1,
        observedIpCountry: 'US',
        statedCountry: 'US',
        observedDeviceFingerprint: null,
        priorSessionDeviceFingerprint: null,
        virtualCaptureDeviceDetected: false,
        screenShareState: 'not_sharing',
        multiMonitorDetected: false,
      },
      now,
    );
    expect(claimResult.decision.lifecycleState).not.toBe('UNKNOWN');

    // 2. Visual + Audio (M9), Device (M10), Linguistic + Elicitation (M11) -- every remaining
    // bundle family layered onto the same session.
    await service.ingestVisualAudioEvidence(
      sessionId,
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
      now,
    );
    await service.ingestDeviceEvidence(
      sessionId,
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
    await service.ingestLinguisticEvidence(
      sessionId,
      {
        claims: [{ claimTopic: 'employer', observedValue: 'Acme Corp', claimedValue: 'Acme Corp' }],
      },
      now,
    );
    const finalResult = await service.ingestElicitationEvidence(
      sessionId,
      { challengeType: 'repeat_phrase', satisfied: true },
      now,
    );

    // Every bundle family's evidence is present in the final decision's evidence reference.
    const bundlesSeen = new Set(finalResult.decision.evidenceRef.events.map((e) => e.bundle));
    expect(bundlesSeen).toEqual(
      new Set(['claim', 'metadata', 'visual', 'audio', 'device', 'linguistic', 'elicitation']),
    );

    // The Decision Engine (M5/M11) produced a coherent, well-formed structured object.
    expect(finalResult.decision.sessionId).toBe(sessionId);
    expect(finalResult.decision.lifecycleState).not.toBe('UNKNOWN');
    expect(finalResult.decision.evidenceRef.posterior.probability).toBeGreaterThan(0.5);

    // Persistence is encrypted at rest for the biometric bundles (M16) yet transparently
    // readable through the service -- proving the decorator boundary is load-bearing, not
    // just present.
    const rawPersistedVisualEvent = (await sharedEvidenceRepository.listBySession(sessionId)).find(
      (e) => e.bundle === 'visual' && e.signalName === 'face_embedding_self_consistency',
    );
    expect(rawPersistedVisualEvent?.value).toMatchObject({ __sherlockEncrypted: true });

    // The status/audit/aggregate surfaces (M8/M13/M16) all reflect this session correctly.
    const status = await service.getSessionStatus(sessionId, 'integration-test-reviewer');
    expect(status.lifecycleState).toBe(finalResult.decision.lifecycleState);
    const auditEntries = await auditLogRepository.listBySession(sessionId);
    expect(auditEntries.some((e) => e.viewedBy === 'integration-test-reviewer')).toBe(true);
    const aggregate = service.getAggregateStatus();
    expect(aggregate.totalSessions).toBeGreaterThanOrEqual(1);

    // 2. Session recovery (M7): a second, entirely independent "replica" -- its own fresh
    // LifecycleStateManager -- recovers this exact session purely from the durable snapshot,
    // without replaying any evidence itself.
    const secondReplicaLifecycleStore = new SessionLifecycleStore(
      new LifecycleStateManager(),
      sharedSnapshotRepository,
    );
    const recoveredState = await secondReplicaLifecycleStore.evaluate(
      sessionId,
      finalResult.decision.evidenceRef.posterior,
      now,
    );
    expect(recoveredState.record.state).toBe(finalResult.decision.lifecycleState);

    // 3. Session routing (M7): the consistent-hash-ring building block a real load balancer
    // would consult is itself correct and available, even though this single-replica
    // deployment does not wire it into the live request path (see `index.ts`'s own doc
    // comment on that decision).
    const ring = new ConsistentHashRing(['replica-a', 'replica-b', 'replica-c']);
    const owner = ring.ownerOf(sessionId);
    expect(['replica-a', 'replica-b', 'replica-c']).toContain(owner);
    // Routing is deterministic -- the same session always resolves to the same owner.
    expect(ring.ownerOf(sessionId)).toBe(owner);
  });

  it('produces a report and narrative for a session that reaches DISQUALIFIED via a real change-point', async () => {
    const atsClient = new InMemoryAtsClient();
    atsClient.seed({
      candidateId: 'candidate-1',
      applicationName: 'Jane Doe',
      applicationEmail: 'jane.doe@example.com',
      calendarInviteAttendeeEmail: 'jane.doe@example.com',
      hasReferencePhoto: true,
      hasPriorIdVerification: true,
      hasAccountHistory: true,
    });
    let faceCalls = 0;
    let voiceCalls = 0;
    const swappingClient: ModelServingClient = {
      extractFaceEmbedding: async (sessionId) => {
        faceCalls += 1;
        return { sessionId, embedding: faceCalls === 1 ? [1, 0, 0] : [0, 1, 0], dimension: 3 };
      },
      extractVoiceEmbedding: async (sessionId) => {
        voiceCalls += 1;
        return { sessionId, embedding: voiceCalls === 1 ? [1, 0, 0] : [0, 1, 0], dimension: 3 };
      },
      detectVisualLiveness: async (sessionId) => ({ sessionId, score: 0.9, isLive: true }),
    };

    const consistencyTracker = new EmbeddingSelfConsistencyTracker();
    const changePointDetector = new ChangePointDetector();

    const service = new SessionOrchestrationService(
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
      new VisualBundleAdapter(swappingClient, consistencyTracker, changePointDetector),
      new AudioBundleAdapter(swappingClient, consistencyTracker, changePointDetector),
      undefined,
      undefined,
      undefined,
      new LlmNarrativeAdapter(new StubLlmProvider()),
    );
    const now = new Date('2026-07-10T12:00:00.000Z');
    const sessionId = 'integration-session-2';

    let result = await service.ingestVisualAudioEvidence(
      sessionId,
      new Uint8Array([1]),
      new Uint8Array([2]),
      now,
    );
    for (let i = 0; i < 10 && result.decision.lifecycleState !== 'DISQUALIFIED'; i++) {
      result = await service.ingestVisualAudioEvidence(
        sessionId,
        new Uint8Array([1]),
        new Uint8Array([2]),
        now,
      );
    }

    expect(result.decision.lifecycleState).toBe('DISQUALIFIED');
    expect(result.decision.reviewerRecommendation).toBe('MANDATORY_REVIEW');
    expect(result.decision.elicitationTrigger).not.toBeNull();
    expect(result.report).not.toBeNull();
    expect(result.report?.lifecycleState).toBe('DISQUALIFIED');
    expect(result.narrative).not.toBeNull();
  });
});
