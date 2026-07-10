import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ClaimBundleAdapter, InMemoryAtsClient, MetadataBundleAdapter } from './bundles/index.js';
import { DecisionEngine } from './decision/index.js';
import { ExplanationEngine } from './explanation/index.js';
import { FusionEngine } from './fusion/index.js';
import { InMemoryEvidenceEventRepository } from './persistence/index.js';
import { LifecycleStateManager } from './statemachine/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Plan M5/M6's ownership boundary, verified structurally rather than just
 * behaviorally: `decision/` and `explanation/` must never import from one
 * another. "The Decision Engine must never generate reports. The Evidence
 * Report Engine must never perform decision-making" is enforced here at
 * the source-file level, not just by convention.
 */
function sourceFilesIn(moduleDir: string): string[] {
  return readdirSync(join(__dirname, moduleDir))
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => readFileSync(join(__dirname, moduleDir, file), 'utf8'));
}

describe('decision/ <-> explanation/ module boundary (Plan M5/M6 ownership split)', () => {
  it('decision/ has no import from explanation/', () => {
    for (const contents of sourceFilesIn('decision')) {
      expect(contents).not.toMatch(/from ['"].*explanation/);
    }
  });

  it('explanation/ has no import from decision/', () => {
    for (const contents of sourceFilesIn('explanation')) {
      expect(contents).not.toMatch(/from ['"].*decision/);
    }
  });
});

/**
 * The full M2-M6 vertical slice, end to end: Bundle Adapters -> Evidence
 * Store (M1) -> Fusion Engine (M3) -> Lifecycle FSM (M4) -> Decision Engine
 * (M5) -> [only when a Decision carries an Alert] Evidence Report Engine
 * (M6). This is the composition point that proves the two engines wire
 * together correctly despite having zero dependency on each other -- the
 * caller (this test, standing in for a future orchestration layer) is
 * solely responsible for handing the Decision's immutable evidence
 * reference to the Explanation Engine.
 */
describe('M2-M6 vertical slice: bundles -> fusion -> lifecycle -> decision -> explanation', () => {
  it('produces a DISQUALIFIED alert whose evidenceRef builds into a well-formed Evidence Report', async () => {
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

    const claimAdapter = new ClaimBundleAdapter(atsClient);
    const metadataAdapter = new MetadataBundleAdapter();
    const evidenceStore = new InMemoryEvidenceEventRepository();
    const fusionEngine = new FusionEngine();
    const lifecycleManager = new LifecycleStateManager();
    const decisionEngine = new DecisionEngine();
    const explanationEngine = new ExplanationEngine();

    const sessionId = 'session-1';
    const t0 = new Date('2026-07-10T12:00:00.000Z');

    const claimEvents = await claimAdapter.buildEvidenceEvents(
      sessionId,
      {
        candidateId: 'candidate-1',
        displayName: 'Jane Doe',
        joinEmail: 'jane.doe@example.com',
        calendarAttendeeEmail: 'jane.doe@example.com',
      },
      t0,
    );
    const metadataEvents = metadataAdapter.buildEvidenceEvents(
      sessionId,
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
      t0,
    );

    for (const event of [...claimEvents, ...metadataEvents]) {
      await evidenceStore.append(event);
    }

    const persisted = await evidenceStore.listBySession(sessionId);
    const posterior = fusionEngine.computePosterior(sessionId, persisted, t0);
    const transition = lifecycleManager.evaluate(sessionId, posterior, t0);

    // Force a mandatory-review path via an explicit contradiction signal, exactly the seam
    // documented in statemachine/lifecycle.ts for the future M9 change-point detector.
    const disqualifyingTransition = lifecycleManager.evaluate(
      sessionId,
      posterior,
      new Date(t0.getTime() + 1),
      {
        detectedAt: new Date(t0.getTime() + 1),
        reason: 'integration-test forced contradiction',
        corroborated: true,
      },
    );

    const decision = decisionEngine.decide({
      sessionId,
      transition: disqualifyingTransition,
      posterior,
      evidence: persisted,
      now: new Date(t0.getTime() + 1),
    });

    expect(decision.lifecycleState).toBe('DISQUALIFIED');
    expect(decision.reviewerRecommendation).toBe('MANDATORY_REVIEW');
    expect(decision.alert).not.toBeNull();
    expect(decision.alert?.severity).toBe('URGENT');

    // The Decision Engine's alert carries only a raw evidence reference -- never a report.
    expect(decision.alert).not.toHaveProperty('report');
    expect(decision.alert).not.toHaveProperty('topContributingSignals');

    const alert = decision.alert;
    if (alert === null) throw new Error('expected an alert to have been raised');

    // Only now, and only via the immutable evidence reference, does the Evidence Report
    // Engine build the actual report -- a separate call, a separate module, no shared state.
    const report = explanationEngine.buildReport({
      sessionId,
      lifecycleState: decision.lifecycleState,
      posterior: decision.evidenceRef.posterior,
      events: decision.evidenceRef.events,
      generatedAt: alert.raisedAt,
    });

    expect(report.sessionId).toBe(sessionId);
    expect(report.lifecycleState).toBe('DISQUALIFIED');
    expect(report.topContributingSignals.length).toBeGreaterThan(0);
    // Every claim-match signal here was a genuine match -- no contradictions expected.
    expect(report.contradictoryEvidence).toHaveLength(0);
    expect(transition.record.state).not.toBe('UNKNOWN'); // sanity: real evidence was accumulated first
  });

  it('abstains unflagged for a session with no meaningful evidence, and never builds an alert-triggered report for it', () => {
    const fusionEngine = new FusionEngine();
    const lifecycleManager = new LifecycleStateManager();
    const decisionEngine = new DecisionEngine();

    const sessionId = 'session-empty';
    const now = new Date('2026-07-10T12:00:00.000Z');

    const posterior = fusionEngine.computePosterior(sessionId, [], now);
    const transition = lifecycleManager.evaluate(sessionId, posterior, now);
    const decision = decisionEngine.decide({ sessionId, transition, posterior, evidence: [], now });

    expect(transition.record.state).toBe('UNKNOWN');
    expect(decision.abstained).toBe(true);
    expect(decision.reviewerRecommendation).toBe('DEFER_TO_ORDINARY_JUDGMENT');
    expect(decision.alert).toBeNull();
  });
});
