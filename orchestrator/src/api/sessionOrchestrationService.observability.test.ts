import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { SessionOrchestrationService } from './sessionOrchestrationService.js';
import { ClaimBundleAdapter, InMemoryAtsClient, MetadataBundleAdapter } from '../bundles/index.js';
import { DecisionEngine } from '../decision/index.js';
import { ExplanationEngine } from '../explanation/index.js';
import { FusionEngine } from '../fusion/index.js';
import { AiMetricsRecorder, OBSERVABILITY_LOG_MESSAGE } from '../observability/index.js';
import {
  InMemoryEvidenceEventRepository,
  InMemorySessionSnapshotRepository,
} from '../persistence/index.js';
import { SessionLifecycleStore } from '../routing/index.js';
import { LifecycleStateManager } from '../statemachine/index.js';

describe('SessionOrchestrationService observability', () => {
  it('records structured session metrics after each pipeline tick', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = pino({ level: 'info' }, stream);
    const recorder = new AiMetricsRecorder(logger);
    const atsClient = new InMemoryAtsClient();
    atsClient.seed({
      candidateId: 'candidate-1',
      applicationName: 'Jane Doe',
      applicationEmail: 'jane@example.com',
      calendarInviteAttendeeEmail: 'jane@example.com',
      hasReferencePhoto: true,
      hasPriorIdVerification: true,
      hasAccountHistory: true,
    });

    const service = new SessionOrchestrationService(
      new ClaimBundleAdapter(atsClient),
      new MetadataBundleAdapter(),
      new InMemoryEvidenceEventRepository(),
      new FusionEngine(),
      new SessionLifecycleStore(new LifecycleStateManager(), new InMemorySessionSnapshotRepository()),
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
      undefined,
      undefined,
      undefined,
      recorder,
    );

    await service.ingestClaimAndMetadataEvidence(
      'session-obs',
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
      new Date('2026-07-10T12:00:00.000Z'),
    );

    const metricLines = lines
      .map((line) => JSON.parse(line) as { msg?: string; observability?: { metricName: string } })
      .filter((entry) => entry.msg === OBSERVABILITY_LOG_MESSAGE);

    expect(metricLines.length).toBeGreaterThan(0);
    expect(metricLines.some((entry) => entry.observability?.metricName.includes('confidence'))).toBe(
      true,
    );
  });
});
