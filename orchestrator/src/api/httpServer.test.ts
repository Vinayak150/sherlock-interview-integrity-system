import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AudioBundleAdapter,
  ClaimBundleAdapter,
  DeviceBundleAdapter,
  EmbeddingSelfConsistencyTracker,
  InMemoryAtsClient,
  MetadataBundleAdapter,
  VisualBundleAdapter,
} from '../bundles/index.js';
import { DecisionEngine } from '../decision/index.js';
import { ExplanationEngine } from '../explanation/index.js';
import { ChangePointDetector, FusionEngine } from '../fusion/index.js';
import { createLogger } from '../logger.js';
import type { ModelServingClient } from '../modelserving_client/index.js';
import {
  InMemoryAccommodationDisclosureRepository,
  InMemoryEvidenceEventRepository,
  InMemorySessionSnapshotRepository,
} from '../persistence/index.js';
import { SessionLifecycleStore } from '../routing/index.js';
import { InMemoryAppealRepository, InMemoryAuditLogRepository } from '../security/index.js';
import { LifecycleStateManager } from '../statemachine/index.js';
import {
  DEFAULT_ISOTONIC_KNOTS,
  DEFAULT_PLATT_PARAMETERS,
} from '../calibration/types.js';
import { createHttpServer } from './httpServer.js';
import { SessionEventBus } from './sessionEventBus.js';
import { SessionOrchestrationService } from './sessionOrchestrationService.js';

function fakeModelServingClient(): ModelServingClient {
  return {
    extractFaceEmbedding: async (sessionId) => ({ sessionId, embedding: [1, 0, 0], dimension: 3 }),
    extractVoiceEmbedding: async (sessionId) => ({ sessionId, embedding: [1, 0, 0], dimension: 3 }),
    detectVisualLiveness: async (sessionId) => ({ sessionId, score: 0.9, isLive: true }),
  };
}

/**
 * Real HTTP requests against a server bound to an ephemeral port -- proves
 * routing, JSON parsing, validation-error responses, and response
 * serialization actually work end-to-end, not just that the handler
 * functions typecheck.
 */
describe('createHttpServer', () => {
  let server: ReturnType<typeof createHttpServer>;
  let baseUrl: string;

  beforeEach(async () => {
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

    const consistencyTracker = new EmbeddingSelfConsistencyTracker();
    const changePointDetector = new ChangePointDetector();
    const modelServingClient = fakeModelServingClient();

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
      new VisualBundleAdapter(modelServingClient, consistencyTracker, changePointDetector),
      new AudioBundleAdapter(modelServingClient, consistencyTracker, changePointDetector),
      new DeviceBundleAdapter(),
      undefined,
      undefined,
      undefined,
      new InMemoryAccommodationDisclosureRepository(),
      new SessionEventBus(),
      new InMemoryAuditLogRepository(),
      new InMemoryAppealRepository(),
    );

    const logger = createLogger({
      nodeEnv: 'test',
      logLevel: 'silent',
      serviceName: 'test',
      database: { host: '', port: 0, database: '', user: '', password: '', ssl: false },
      redis: { url: '' },
      http: { port: 0, host: '127.0.0.1' },
      modelServing: { baseUrl: 'http://localhost:8081' },
      replicaId: 'test-replica',
      security: { fieldEncryptionKey: 'test-key', dataResidencyRegion: 'us' },
      confidenceCalibration: {
        enabled: false,
        method: 'platt',
        platt: DEFAULT_PLATT_PARAMETERS,
        isotonicKnots: DEFAULT_ISOTONIC_KNOTS,
      },
    });

    server = createHttpServer(service, logger);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /health returns 200 ok', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('GET /sessions/:sessionId/status returns UNKNOWN for a never-seen session', async () => {
    const response = await fetch(`${baseUrl}/sessions/session-1/status`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sessionId: 'session-1',
      lifecycleState: 'UNKNOWN',
      hasAccommodationDisclosure: false,
    });
  });

  it('POST /sessions/:sessionId/evidence ingests evidence and returns a Decision', async () => {
    const response = await fetch(`${baseUrl}/sessions/session-1/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidate: {
          candidateId: 'candidate-1',
          displayName: 'Jane Doe',
          joinEmail: 'jane.doe@example.com',
          calendarAttendeeEmail: 'jane.doe@example.com',
        },
        metadata: {
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
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      decision: { lifecycleState: string; sessionId: string };
    };
    expect(body.decision.sessionId).toBe('session-1');
    expect(body.decision.lifecycleState).not.toBe('UNKNOWN');
  });

  it('a later GET status reflects the state produced by a prior POST evidence call', async () => {
    await fetch(`${baseUrl}/sessions/session-2/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidate: {
          candidateId: 'candidate-1',
          displayName: 'Jane Doe',
          joinEmail: 'jane.doe@example.com',
          calendarAttendeeEmail: 'jane.doe@example.com',
        },
        metadata: {
          joinMethod: null,
          joinOrder: null,
          observedIpCountry: null,
          statedCountry: null,
          observedDeviceFingerprint: null,
          priorSessionDeviceFingerprint: null,
          virtualCaptureDeviceDetected: null,
          screenShareState: null,
          multiMonitorDetected: null,
        },
      }),
    });

    const statusResponse = await fetch(`${baseUrl}/sessions/session-2/status`);
    const status = (await statusResponse.json()) as { lifecycleState: string };
    expect(status.lifecycleState).not.toBe('UNKNOWN');
  });

  it('returns 400 for a request body that fails schema validation', async () => {
    const response = await fetch(`${baseUrl}/sessions/session-1/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate: { candidateId: '' } }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_request');
  });

  it('returns 400 for a malformed JSON body', async () => {
    const response = await fetch(`${baseUrl}/sessions/session-1/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not valid json',
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_json');
  });

  it('returns 405 for a GET on the evidence route', async () => {
    const response = await fetch(`${baseUrl}/sessions/session-1/evidence`);
    expect(response.status).toBe(405);
  });

  it('returns 405 for a POST on the status route', async () => {
    const response = await fetch(`${baseUrl}/sessions/session-1/status`, { method: 'POST' });
    expect(response.status).toBe(405);
  });

  it('returns 404 for an unknown route', async () => {
    const response = await fetch(`${baseUrl}/not-a-real-route`);
    expect(response.status).toBe(404);
  });

  it('isolates decisions per sessionId end-to-end over real HTTP', async () => {
    const body = JSON.stringify({
      candidate: {
        candidateId: 'candidate-1',
        displayName: 'Jane Doe',
        joinEmail: 'jane.doe@example.com',
        calendarAttendeeEmail: 'jane.doe@example.com',
      },
      metadata: {
        joinMethod: null,
        joinOrder: null,
        observedIpCountry: null,
        statedCountry: null,
        observedDeviceFingerprint: null,
        priorSessionDeviceFingerprint: null,
        virtualCaptureDeviceDetected: null,
        screenShareState: null,
        multiMonitorDetected: null,
      },
    });

    await fetch(`${baseUrl}/sessions/session-x/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const untouchedStatus = await fetch(`${baseUrl}/sessions/session-y/status`);
    await expect(untouchedStatus.json()).resolves.toEqual({
      sessionId: 'session-y',
      lifecycleState: 'UNKNOWN',
      hasAccommodationDisclosure: false,
    });
  });

  describe('POST /sessions/:sessionId/visual-audio-evidence (Plan M9)', () => {
    it('ingests a base64-encoded frame and returns a Decision', async () => {
      const response = await fetch(`${baseUrl}/sessions/session-1/visual-audio-evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          framePayload: Buffer.from('frame-bytes').toString('base64'),
          audioPayload: null,
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { decision: { sessionId: string } };
      expect(body.decision.sessionId).toBe('session-1');
    });

    it('returns 400 when neither framePayload nor audioPayload is provided', async () => {
      const response = await fetch(`${baseUrl}/sessions/session-1/visual-audio-evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ framePayload: null, audioPayload: null }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 400 for invalid base64', async () => {
      const response = await fetch(`${baseUrl}/sessions/session-1/visual-audio-evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ framePayload: '', audioPayload: null }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 405 for a GET on the visual-audio-evidence route', async () => {
      const response = await fetch(`${baseUrl}/sessions/session-1/visual-audio-evidence`);
      expect(response.status).toBe(405);
    });
  });

  describe('POST /sessions/:sessionId/device-evidence (Plan M10)', () => {
    it('ingests device counts and returns a Decision', async () => {
      const response = await fetch(`${baseUrl}/sessions/session-1/device-evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consentGranted: true,
          windowMs: 60_000,
          tabFocusChangeCount: 1,
          applicationSwitchCount: 0,
          clipboardPasteCount: 0,
          keyboardRhythmAnomalyCount: 0,
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { decision: { sessionId: string } };
      expect(body.decision.sessionId).toBe('session-1');
    });

    it('returns 400 for a negative count', async () => {
      const response = await fetch(`${baseUrl}/sessions/session-1/device-evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consentGranted: true,
          windowMs: 60_000,
          tabFocusChangeCount: -1,
          applicationSwitchCount: 0,
          clipboardPasteCount: 0,
          keyboardRhythmAnomalyCount: 0,
        }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 405 for a GET on the device-evidence route', async () => {
      const response = await fetch(`${baseUrl}/sessions/session-1/device-evidence`);
      expect(response.status).toBe(405);
    });
  });

  describe('POST /sessions/:sessionId/override (Plan M13, ADR-3)', () => {
    it('moves a session directly to the requested state', async () => {
      const response = await fetch(`${baseUrl}/sessions/session-1/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nextState: 'DISQUALIFIED', reason: 'confirmed fraud out of band' }),
      });

      expect(response.status).toBe(200);
      const statusResponse = await fetch(`${baseUrl}/sessions/session-1/status`);
      const status = (await statusResponse.json()) as { lifecycleState: string };
      expect(status.lifecycleState).toBe('DISQUALIFIED');
    });

    it('returns 400 for an unrecognized lifecycle state', async () => {
      const response = await fetch(`${baseUrl}/sessions/session-1/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nextState: 'NOT_A_REAL_STATE' }),
      });

      expect(response.status).toBe(400);
    });

    it('returns 405 for a GET on the override route', async () => {
      const response = await fetch(`${baseUrl}/sessions/session-1/override`);
      expect(response.status).toBe(405);
    });
  });

  describe('POST /sessions/:sessionId/accommodation-disclosure (Plan M13, ADR-13)', () => {
    it('records a disclosure and reflects it on a later status read', async () => {
      const response = await fetch(`${baseUrl}/sessions/session-1/accommodation-disclosure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'interpreter present' }),
      });
      expect(response.status).toBe(200);

      const statusResponse = await fetch(`${baseUrl}/sessions/session-1/status`);
      const status = (await statusResponse.json()) as { hasAccommodationDisclosure: boolean };
      expect(status.hasAccommodationDisclosure).toBe(true);
    });

    it('returns 400 for an empty reason', async () => {
      const response = await fetch(`${baseUrl}/sessions/session-1/accommodation-disclosure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: '' }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /sessions/aggregate (Plan M13)', () => {
    it('reports zero sessions before anything has been ingested', async () => {
      const response = await fetch(`${baseUrl}/sessions/aggregate`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { totalSessions: number; unknownRate: number };
      expect(body.totalSessions).toBe(0);
      expect(body.unknownRate).toBe(0);
    });

    it('reflects sessions after they have been touched', async () => {
      await fetch(`${baseUrl}/sessions/session-1/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nextState: 'LOST_CONFIDENCE' }),
      });

      const response = await fetch(`${baseUrl}/sessions/aggregate`);
      const body = (await response.json()) as {
        totalSessions: number;
        countsByState: Record<string, number>;
      };
      expect(body.totalSessions).toBe(1);
      expect(body.countsByState.LOST_CONFIDENCE).toBe(1);
    });
  });

  describe('GET /sessions/:sessionId/events (Plan M13 SSE push)', () => {
    it('streams the Decision produced by a subsequent POST as an SSE event', async () => {
      const received: string[] = [];
      const controller = new AbortController();
      const streamPromise = (async () => {
        const response = await fetch(`${baseUrl}/sessions/session-1/events`, {
          signal: controller.signal,
        });
        expect(response.headers.get('content-type')).toContain('text/event-stream');
        const reader = response.body?.getReader();
        if (reader === undefined) throw new Error('no readable stream');
        const decoder = new TextDecoder();
        while (received.length === 0) {
          const { value, done } = await reader.read();
          if (done) break;
          received.push(decoder.decode(value));
        }
      })();

      // Give the SSE connection a moment to attach its subscription before publishing.
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Ingestion (not override) is what actually publishes to the event bus -- it is the
      // one path that produces a real `Decision` (see `SessionOrchestrationService.runPipeline`).
      await fetch(`${baseUrl}/sessions/session-1/device-evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consentGranted: true,
          windowMs: 60_000,
          tabFocusChangeCount: 1,
          applicationSwitchCount: 0,
          clipboardPasteCount: 0,
          keyboardRhythmAnomalyCount: 0,
        }),
      });

      await streamPromise;
      controller.abort();

      expect(received.length).toBeGreaterThan(0);
      expect(received[0]).toContain('data:');
      expect(received[0]).toContain('session-1');
    });
  });

  describe('POST/GET /sessions/:sessionId/appeals (Plan M16)', () => {
    it('files an appeal and returns it in PENDING status', async () => {
      const response = await fetch(`${baseUrl}/sessions/session-1/appeals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateStatement: 'That was really me on the call.' }),
      });

      expect(response.status).toBe(200);
      const appeal = (await response.json()) as { status: string; sessionId: string };
      expect(appeal.status).toBe('PENDING');
      expect(appeal.sessionId).toBe('session-1');
    });

    it('returns 400 for an empty candidateStatement', async () => {
      const response = await fetch(`${baseUrl}/sessions/session-1/appeals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateStatement: '' }),
      });

      expect(response.status).toBe(400);
    });

    it('lists filed appeals for a session', async () => {
      await fetch(`${baseUrl}/sessions/session-1/appeals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateStatement: 'statement' }),
      });

      const response = await fetch(`${baseUrl}/sessions/session-1/appeals`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { appeals: readonly unknown[] };
      expect(body.appeals).toHaveLength(1);
    });

    it('returns 405 for a DELETE on the appeals route', async () => {
      const response = await fetch(`${baseUrl}/sessions/session-1/appeals`, { method: 'DELETE' });
      expect(response.status).toBe(405);
    });
  });
});
