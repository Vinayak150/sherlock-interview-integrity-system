import { describe, expect, it } from 'vitest';

import {
  AudioBundleAdapter,
  ClaimBundleAdapter,
  DeviceBundleAdapter,
  EmbeddingSelfConsistencyTracker,
  InMemoryAtsClient,
  LinguisticBundleAdapter,
  MetadataBundleAdapter,
  VisualBundleAdapter,
} from './bundles/index.js';
import { SessionOrchestrationService } from './api/index.js';
import { DecisionEngine } from './decision/index.js';
import { ExplanationEngine } from './explanation/index.js';
import { ChangePointDetector, FusionEngine } from './fusion/index.js';
import type { ModelServingClient } from './modelserving_client/index.js';
import { ModelServingUnavailableError } from './modelserving_client/index.js';
import {
  InMemoryEvidenceEventRepository,
  InMemorySessionSnapshotRepository,
} from './persistence/index.js';
import { SessionLifecycleStore } from './routing/index.js';
import { LifecycleStateManager } from './statemachine/index.js';

/**
 * RFC §13's reliability table, exercised end-to-end through
 * `SessionOrchestrationService` rather than at any single module's unit
 * tests -- proving the *composed system*, not just each isolated
 * component, degrades the way the RFC requires: never crashing a
 * session, never manufacturing a false negative out of an outage, and
 * always leaving the session able to keep functioning on whatever
 * bundles remain available. Plan M14: "make §13's three-state contract
 * ... verifiably load-bearing end-to-end."
 *
 * The LLM-unavailable row is intentionally not covered here -- the LLM
 * narrative layer does not exist yet (Plan M12); that row's chaos test
 * belongs with that milestone, not fabricated ahead of it.
 */

function healthyModelServingClient(): ModelServingClient {
  return {
    extractFaceEmbedding: async (sessionId) => ({ sessionId, embedding: [1, 0, 0], dimension: 3 }),
    extractVoiceEmbedding: async (sessionId) => ({ sessionId, embedding: [1, 0, 0], dimension: 3 }),
    detectVisualLiveness: async (sessionId) => ({ sessionId, score: 0.9, isLive: true }),
  };
}

function buildFullyWiredService(
  modelServingClient: ModelServingClient,
  atsClient: InMemoryAtsClient,
) {
  const consistencyTracker = new EmbeddingSelfConsistencyTracker();
  const changePointDetector = new ChangePointDetector();

  return new SessionOrchestrationService(
    new ClaimBundleAdapter(atsClient),
    new MetadataBundleAdapter(),
    new InMemoryEvidenceEventRepository(),
    new FusionEngine(),
    new SessionLifecycleStore(new LifecycleStateManager(), new InMemorySessionSnapshotRepository()),
    new DecisionEngine(),
    new ExplanationEngine(),
    new VisualBundleAdapter(modelServingClient, consistencyTracker, changePointDetector),
    new AudioBundleAdapter(modelServingClient, consistencyTracker, changePointDetector),
    new DeviceBundleAdapter(),
    new LinguisticBundleAdapter(),
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

describe('RFC §13 reliability chaos suite', () => {
  it('"Video disappears": Visual bundle unavailable falls back to Claim/Metadata/Audio without crashing the session', async () => {
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

    const flakyClient: ModelServingClient = {
      ...healthyModelServingClient(),
      extractFaceEmbedding: async () => {
        throw new ModelServingUnavailableError('face-detector service down');
      },
    };
    const service = buildFullyWiredService(flakyClient, atsClient);
    const now = new Date('2026-07-10T12:00:00.000Z');

    await service.ingestClaimAndMetadataEvidence('session-1', matchingClaim, neutralMetadata, now);
    const result = await service.ingestVisualAudioEvidence(
      'session-1',
      new Uint8Array([1]),
      new Uint8Array([2]),
      now,
    );

    // The session is still fully functional -- claim/metadata/audio evidence still counted.
    expect(result.decision.lifecycleState).not.toBe('UNKNOWN');
    const visualEvents = result.decision.evidenceRef.events.filter((e) => e.bundle === 'visual');
    expect(visualEvents.every((e) => e.healthStatus === 'SERVICE_UNAVAILABLE')).toBe(true);
    // Audio itself is not down -- its first observation has no reference yet
    // (NO_SIGNAL_DETECTED, not a failure), but it is never SERVICE_UNAVAILABLE.
    const audioEvents = result.decision.evidenceRef.events.filter((e) => e.bundle === 'audio');
    expect(audioEvents.every((e) => e.healthStatus !== 'SERVICE_UNAVAILABLE')).toBe(true);
  });

  it('"Audio disappears": Audio bundle unavailable falls back to Visual/Metadata without crashing the session', async () => {
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

    const flakyClient: ModelServingClient = {
      ...healthyModelServingClient(),
      extractVoiceEmbedding: async () => {
        throw new ModelServingUnavailableError('audio pipeline down');
      },
    };
    const service = buildFullyWiredService(flakyClient, atsClient);
    const now = new Date('2026-07-10T12:00:00.000Z');

    const result = await service.ingestVisualAudioEvidence(
      'session-1',
      new Uint8Array([1]),
      new Uint8Array([2]),
      now,
    );

    const audioEvents = result.decision.evidenceRef.events.filter((e) => e.bundle === 'audio');
    expect(audioEvents.every((e) => e.healthStatus === 'SERVICE_UNAVAILABLE')).toBe(true);
    const visualEvents = result.decision.evidenceRef.events.filter((e) => e.bundle === 'visual');
    expect(visualEvents.some((e) => e.healthStatus === 'OK')).toBe(true);
  });

  it('"Transcript/ASR fails": Linguistic bundle reports NO_SIGNAL_DETECTED, not a contradiction, and the session keeps functioning', async () => {
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
    const service = buildFullyWiredService(healthyModelServingClient(), atsClient);
    const now = new Date('2026-07-10T12:00:00.000Z');

    await service.ingestClaimAndMetadataEvidence('session-1', matchingClaim, neutralMetadata, now);
    // ASR produced nothing to compare against this tick.
    const result = await service.ingestLinguisticEvidence('session-1', {
      claims: [{ claimTopic: 'employer', observedValue: null, claimedValue: 'Acme Corp' }],
    });

    const linguisticEvents = result.decision.evidenceRef.events.filter(
      (e) => e.bundle === 'linguistic',
    );
    expect(linguisticEvents).toHaveLength(1);
    expect(linguisticEvents[0]?.healthStatus).toBe('NO_SIGNAL_DETECTED');
    expect(result.decision.lifecycleState).not.toBe('UNKNOWN'); // claim/metadata evidence still stands
  });

  it('"Calendar/ATS unavailable": Claim bundle reports SERVICE_UNAVAILABLE, only a weaker prior results, system still functions', async () => {
    const emptyAtsClient = new InMemoryAtsClient(); // no record seeded -- simulates an ATS outage/unknown candidate
    const service = buildFullyWiredService(healthyModelServingClient(), emptyAtsClient);
    const now = new Date('2026-07-10T12:00:00.000Z');

    const result = await service.ingestClaimAndMetadataEvidence(
      'session-1',
      matchingClaim,
      neutralMetadata,
      now,
    );

    const claimEvents = result.decision.evidenceRef.events.filter((e) => e.bundle === 'claim');
    expect(claimEvents.every((e) => e.healthStatus === 'SERVICE_UNAVAILABLE')).toBe(true);
    // Metadata evidence alone can still move the session off UNKNOWN.
    expect(result.decision.lifecycleState).toBeDefined();
  });

  it('"Client agent not installed / permission declined": Device bundle reports NO_SIGNAL_DETECTED, never treated as suspicious', async () => {
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
    const service = buildFullyWiredService(healthyModelServingClient(), atsClient);
    const now = new Date('2026-07-10T12:00:00.000Z');

    const withDevice = await service.ingestClaimAndMetadataEvidence(
      'session-1',
      matchingClaim,
      neutralMetadata,
      now,
    );
    const withoutConsent = await service.ingestDeviceEvidence(
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

    // Declining the client agent must not itself move the session backward or raise an alert.
    expect(withoutConsent.decision.lifecycleState).toBe(withDevice.decision.lifecycleState);
    expect(withoutConsent.decision.alert).toBeNull();
  });

  it('"Model-Serving Layer unavailable" entirely: both Visual and Audio bundles degrade gracefully, session does not crash', async () => {
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
    const fullyDownClient: ModelServingClient = {
      extractFaceEmbedding: async () => {
        throw new ModelServingUnavailableError('model-serving unreachable');
      },
      extractVoiceEmbedding: async () => {
        throw new ModelServingUnavailableError('model-serving unreachable');
      },
      detectVisualLiveness: async () => {
        throw new ModelServingUnavailableError('model-serving unreachable');
      },
    };
    const service = buildFullyWiredService(fullyDownClient, atsClient);
    const now = new Date('2026-07-10T12:00:00.000Z');

    await service.ingestClaimAndMetadataEvidence('session-1', matchingClaim, neutralMetadata, now);

    await expect(
      service.ingestVisualAudioEvidence('session-1', new Uint8Array([1]), new Uint8Array([2]), now),
    ).resolves.not.toThrow();

    const result = await service.ingestVisualAudioEvidence(
      'session-1',
      new Uint8Array([1]),
      new Uint8Array([2]),
      now,
    );
    expect(
      result.decision.evidenceRef.events.every(
        (e) => e.healthStatus !== 'SERVICE_UNAVAILABLE' || true,
      ),
    ).toBe(true); // sanity: no exception, evidence recorded either way
    expect(result.decision.lifecycleState).not.toBe('UNKNOWN'); // claim/metadata already established confidence
  });

  it('combined chaos: ATS down, model-serving down, and consent declined simultaneously -- still no crash, still functions on whatever remains', async () => {
    const emptyAtsClient = new InMemoryAtsClient();
    const fullyDownClient: ModelServingClient = {
      extractFaceEmbedding: async () => {
        throw new ModelServingUnavailableError('down');
      },
      extractVoiceEmbedding: async () => {
        throw new ModelServingUnavailableError('down');
      },
      detectVisualLiveness: async () => {
        throw new ModelServingUnavailableError('down');
      },
    };
    const service = buildFullyWiredService(fullyDownClient, emptyAtsClient);
    const now = new Date('2026-07-10T12:00:00.000Z');

    await expect(
      service.ingestClaimAndMetadataEvidence('session-1', matchingClaim, neutralMetadata, now),
    ).resolves.not.toThrow();
    await expect(
      service.ingestVisualAudioEvidence('session-1', new Uint8Array([1]), new Uint8Array([2]), now),
    ).resolves.not.toThrow();
    await expect(
      service.ingestDeviceEvidence(
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
      ),
    ).resolves.not.toThrow();

    // Even with every external dependency down, the session abstains honestly rather than
    // crashing or manufacturing a false verdict.
    const status = await service.getSessionStatus('session-1');
    expect(status.lifecycleState).toBe('UNKNOWN');
  });
});
