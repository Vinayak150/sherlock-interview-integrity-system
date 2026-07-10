import { describe, expect, it } from 'vitest';

import { ClaimBundleAdapter, InMemoryAtsClient, MetadataBundleAdapter } from './bundles/index.js';
import { InMemoryEvidenceEventRepository } from './persistence/index.js';
import { ColdStartStateManager } from './statemachine/index.js';

/**
 * Plan M2's "first vertical slice with zero ML dependency": Claim + Metadata
 * Bundle Adapters (RFC §4-A/B) produce EvidenceEvents, the Evidence Store
 * (M1) durably persists them *before* they're allowed to affect state
 * (Plan §9 "Ledger-authoritative-before-score ordering" — honored here even
 * though the real Fusion Engine that formalizes it doesn't exist until M3),
 * and the cold-start State Manager reaches `POSSIBLE_CANDIDATE` from
 * `UNKNOWN` on nothing but real claim-match evidence. No embeddings, no
 * classifiers, no Model-Serving Layer involved anywhere in this path.
 */
describe('M2 vertical slice: Claim + Metadata bundles -> Evidence Store -> cold-start FSM', () => {
  it('persists claim and metadata evidence and reaches POSSIBLE_CANDIDATE on a genuine match', async () => {
    const atsClient = new InMemoryAtsClient();
    atsClient.seed({
      candidateId: 'candidate-1',
      applicationName: 'Jane Doe',
      applicationEmail: 'jane.doe@example.com',
      calendarInviteAttendeeEmail: 'jane.doe@example.com',
      hasReferencePhoto: true,
      hasPriorIdVerification: false,
      hasAccountHistory: false,
    });

    const claimAdapter = new ClaimBundleAdapter(atsClient);
    const metadataAdapter = new MetadataBundleAdapter();
    const evidenceStore = new InMemoryEvidenceEventRepository();
    const stateManager = new ColdStartStateManager();

    const sessionId = 'session-1';

    expect(stateManager.getState(sessionId)).toBe('UNKNOWN');

    const claimEvents = await claimAdapter.buildEvidenceEvents(sessionId, {
      candidateId: 'candidate-1',
      displayName: 'Jane Doe',
      joinEmail: 'jane.doe@example.com',
      calendarAttendeeEmail: 'jane.doe@example.com',
    });

    const metadataEvents = metadataAdapter.buildEvidenceEvents(sessionId, {
      joinMethod: 'direct_invite_link',
      joinOrder: 1,
      observedIpCountry: 'US',
      statedCountry: 'US',
      observedDeviceFingerprint: null,
      priorSessionDeviceFingerprint: null,
      virtualCaptureDeviceDetected: false,
      screenShareState: 'not_sharing',
      multiMonitorDetected: false,
    });

    for (const event of [...claimEvents, ...metadataEvents]) {
      await evidenceStore.append(event);
    }

    const persisted = await evidenceStore.listBySession(sessionId);
    expect(persisted).toHaveLength(claimEvents.length + metadataEvents.length);

    const transition = stateManager.recordClaimEvidence(
      sessionId,
      persisted.filter((event) => event.bundle === 'claim'),
    );

    expect(transition).toMatchObject({ state: 'POSSIBLE_CANDIDATE', transitioned: true });
    expect(stateManager.getState(sessionId)).toBe('POSSIBLE_CANDIDATE');
  });

  it('stays UNKNOWN when the only persisted evidence is an ATS-outage SERVICE_UNAVAILABLE result', async () => {
    const claimAdapter = new ClaimBundleAdapter(new InMemoryAtsClient());
    const evidenceStore = new InMemoryEvidenceEventRepository();
    const stateManager = new ColdStartStateManager();
    const sessionId = 'session-2';

    const claimEvents = await claimAdapter.buildEvidenceEvents(sessionId, {
      candidateId: 'candidate-without-an-ats-record',
      displayName: 'Jane Doe',
      joinEmail: 'jane.doe@example.com',
      calendarAttendeeEmail: 'jane.doe@example.com',
    });

    for (const event of claimEvents) {
      await evidenceStore.append(event);
    }

    const persisted = await evidenceStore.listBySession(sessionId);
    expect(persisted.every((event) => event.healthStatus === 'SERVICE_UNAVAILABLE')).toBe(true);

    const transition = stateManager.recordClaimEvidence(sessionId, persisted);

    expect(transition).toMatchObject({ state: 'UNKNOWN', transitioned: false });
  });

  it('stays UNKNOWN when claim evidence is a genuine mismatch, not merely absent', async () => {
    const atsClient = new InMemoryAtsClient();
    atsClient.seed({
      candidateId: 'candidate-1',
      applicationName: 'Jane Doe',
      applicationEmail: 'jane.doe@example.com',
      calendarInviteAttendeeEmail: null,
      hasReferencePhoto: false,
      hasPriorIdVerification: false,
      hasAccountHistory: false,
    });

    const claimAdapter = new ClaimBundleAdapter(atsClient);
    const evidenceStore = new InMemoryEvidenceEventRepository();
    const stateManager = new ColdStartStateManager();
    const sessionId = 'session-3';

    const claimEvents = await claimAdapter.buildEvidenceEvents(sessionId, {
      candidateId: 'candidate-1',
      displayName: 'Someone Else Entirely',
      joinEmail: 'someone.else@another-domain.example',
      calendarAttendeeEmail: null,
    });

    for (const event of claimEvents) {
      await evidenceStore.append(event);
    }

    const persisted = await evidenceStore.listBySession(sessionId);
    const transition = stateManager.recordClaimEvidence(sessionId, persisted);

    expect(transition).toMatchObject({ state: 'UNKNOWN', transitioned: false });
  });
});
