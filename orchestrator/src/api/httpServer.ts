import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { ZodError } from 'zod';

import type { Logger } from '../logger.js';
import {
  ApplyHumanOverrideRequestSchema,
  FileAppealRequestSchema,
  IngestDeviceEvidenceRequestSchema,
  IngestElicitationEvidenceRequestSchema,
  IngestEvidenceRequestSchema,
  IngestLinguisticEvidenceRequestSchema,
  IngestVisualAudioEvidenceRequestSchema,
  RecordAccommodationDisclosureRequestSchema,
} from './schemas.js';
import type { SessionOrchestrationService } from './sessionOrchestrationService.js';

/**
 * The ingress HTTP surface (Plan §5 repository structure `orchestrator/api/`;
 * this batch's "M8 — External Interfaces/API Layer"). Deliberately thin:
 * every handler below does request parsing/validation and response
 * serialization only, then delegates the actual work to
 * `SessionOrchestrationService` — no fusion, lifecycle, decision, or
 * explanation logic lives in this file.
 *
 * Plain Node `http`, no framework dependency: three routes do not
 * justify a new dependency, consistent with this codebase's own
 * infrastructure-restraint stance (ADR-14) — a router library is
 * reasonable at a route count this module doesn't have.
 */

const MAX_REQUEST_BODY_BYTES = 1024 * 1024; // 1 MiB -- generous for this payload shape, bounded to avoid unbounded memory use.

interface RouteMatch {
  readonly sessionId: string;
}

function matchSessionRoute(pathname: string, suffix: string): RouteMatch | null {
  const pattern = new RegExp(`^/sessions/([^/]+)/${suffix}$`);
  const match = pattern.exec(pathname);
  if (match === null) return null;
  const sessionId = decodeURIComponent(match[1] as string);
  return sessionId.trim() === '' ? null : { sessionId };
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

class HttpBodyTooLargeError extends Error {}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buf = chunk as Buffer;
    totalBytes += buf.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw new HttpBodyTooLargeError('Request body exceeds the maximum allowed size');
    }
    chunks.push(buf);
  }

  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function zodIssues(error: ZodError): readonly string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

async function handleIngestEvidence(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  service: SessionOrchestrationService,
): Promise<void> {
  let rawBody: unknown;
  try {
    rawBody = await readJsonBody(req);
  } catch (error) {
    if (error instanceof HttpBodyTooLargeError) {
      sendJson(res, 413, { error: 'payload_too_large', message: error.message });
      return;
    }
    sendJson(res, 400, { error: 'invalid_json', message: 'Request body must be valid JSON' });
    return;
  }

  let request;
  try {
    request = IngestEvidenceRequestSchema.parse(rawBody);
  } catch (error) {
    if (error instanceof ZodError) {
      sendJson(res, 400, { error: 'invalid_request', issues: zodIssues(error) });
      return;
    }
    throw error;
  }

  const result = await service.ingestClaimAndMetadataEvidence(
    sessionId,
    request.candidate,
    request.metadata,
  );
  sendJson(res, 200, result);
}

async function handleGetStatus(
  res: ServerResponse,
  sessionId: string,
  service: SessionOrchestrationService,
): Promise<void> {
  sendJson(res, 200, await service.getSessionStatus(sessionId));
}

function handleGetAggregateStatus(res: ServerResponse, service: SessionOrchestrationService): void {
  sendJson(res, 200, service.getAggregateStatus());
}

async function handleApplyHumanOverride(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  service: SessionOrchestrationService,
): Promise<void> {
  let rawBody: unknown;
  try {
    rawBody = await readJsonBody(req);
  } catch (error) {
    if (error instanceof HttpBodyTooLargeError) {
      sendJson(res, 413, { error: 'payload_too_large', message: error.message });
      return;
    }
    sendJson(res, 400, { error: 'invalid_json', message: 'Request body must be valid JSON' });
    return;
  }

  let request;
  try {
    request = ApplyHumanOverrideRequestSchema.parse(rawBody);
  } catch (error) {
    if (error instanceof ZodError) {
      sendJson(res, 400, { error: 'invalid_request', issues: zodIssues(error) });
      return;
    }
    throw error;
  }

  const result = await service.applyHumanOverride(sessionId, request.nextState, request.reason);
  sendJson(res, 200, result);
}

async function handleRecordAccommodationDisclosure(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  service: SessionOrchestrationService,
): Promise<void> {
  let rawBody: unknown;
  try {
    rawBody = await readJsonBody(req);
  } catch (error) {
    if (error instanceof HttpBodyTooLargeError) {
      sendJson(res, 413, { error: 'payload_too_large', message: error.message });
      return;
    }
    sendJson(res, 400, { error: 'invalid_json', message: 'Request body must be valid JSON' });
    return;
  }

  let request;
  try {
    request = RecordAccommodationDisclosureRequestSchema.parse(rawBody);
  } catch (error) {
    if (error instanceof ZodError) {
      sendJson(res, 400, { error: 'invalid_request', issues: zodIssues(error) });
      return;
    }
    throw error;
  }

  try {
    await service.recordAccommodationDisclosure(sessionId, request.reason);
    sendJson(res, 200, { sessionId, recorded: true });
  } catch (error) {
    sendJson(res, 503, {
      error: 'accommodation_disclosure_not_configured',
      message: (error as Error).message,
    });
  }
}

async function handleFileAppeal(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  service: SessionOrchestrationService,
): Promise<void> {
  let rawBody: unknown;
  try {
    rawBody = await readJsonBody(req);
  } catch (error) {
    if (error instanceof HttpBodyTooLargeError) {
      sendJson(res, 413, { error: 'payload_too_large', message: error.message });
      return;
    }
    sendJson(res, 400, { error: 'invalid_json', message: 'Request body must be valid JSON' });
    return;
  }

  let request;
  try {
    request = FileAppealRequestSchema.parse(rawBody);
  } catch (error) {
    if (error instanceof ZodError) {
      sendJson(res, 400, { error: 'invalid_request', issues: zodIssues(error) });
      return;
    }
    throw error;
  }

  try {
    const appeal = await service.fileAppeal(sessionId, request.candidateStatement);
    sendJson(res, 200, appeal);
  } catch (error) {
    sendJson(res, 503, {
      error: 'appeal_repository_not_configured',
      message: (error as Error).message,
    });
  }
}

async function handleListAppeals(
  res: ServerResponse,
  sessionId: string,
  service: SessionOrchestrationService,
): Promise<void> {
  try {
    const appeals = await service.listAppeals(sessionId);
    sendJson(res, 200, { appeals });
  } catch (error) {
    sendJson(res, 503, {
      error: 'appeal_repository_not_configured',
      message: (error as Error).message,
    });
  }
}

/**
 * Server-Sent Events push (Plan M13: "WebSocket/SSE client"). SSE over
 * plain HTTP, consistent with this file's "no framework" stance --
 * `node:http` already supports a long-lived chunked response without any
 * additional dependency. Each event is one `Decision`, published by
 * `SessionEventBus` the moment `SessionOrchestrationService` finishes
 * computing it (a read-only side channel — see that module's doc
 * comment).
 */
function handleSubscribeToSession(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  service: SessionOrchestrationService,
): void {
  let unsubscribe: (() => void) | undefined;
  try {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    unsubscribe = service.subscribeToSession(sessionId, (decision) => {
      res.write(`data: ${JSON.stringify(decision)}\n\n`);
    });
  } catch (error) {
    sendJson(res, 503, {
      error: 'session_event_bus_not_configured',
      message: (error as Error).message,
    });
    return;
  }

  req.on('close', () => unsubscribe?.());
}

async function handleIngestVisualAudioEvidence(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  service: SessionOrchestrationService,
): Promise<void> {
  let rawBody: unknown;
  try {
    rawBody = await readJsonBody(req);
  } catch (error) {
    if (error instanceof HttpBodyTooLargeError) {
      sendJson(res, 413, { error: 'payload_too_large', message: error.message });
      return;
    }
    sendJson(res, 400, { error: 'invalid_json', message: 'Request body must be valid JSON' });
    return;
  }

  let request;
  try {
    request = IngestVisualAudioEvidenceRequestSchema.parse(rawBody);
  } catch (error) {
    if (error instanceof ZodError) {
      sendJson(res, 400, { error: 'invalid_request', issues: zodIssues(error) });
      return;
    }
    throw error;
  }

  try {
    const framePayload =
      request.framePayload === null ? null : Buffer.from(request.framePayload, 'base64');
    const audioPayload =
      request.audioPayload === null ? null : Buffer.from(request.audioPayload, 'base64');
    const result = await service.ingestVisualAudioEvidence(sessionId, framePayload, audioPayload);
    sendJson(res, 200, result);
  } catch (error) {
    // Visual/Audio adapters not configured for this deployment -- a configuration error, not a
    // client input error.
    sendJson(res, 503, { error: 'visual_audio_not_configured', message: (error as Error).message });
  }
}

async function handleIngestDeviceEvidence(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  service: SessionOrchestrationService,
): Promise<void> {
  let rawBody: unknown;
  try {
    rawBody = await readJsonBody(req);
  } catch (error) {
    if (error instanceof HttpBodyTooLargeError) {
      sendJson(res, 413, { error: 'payload_too_large', message: error.message });
      return;
    }
    sendJson(res, 400, { error: 'invalid_json', message: 'Request body must be valid JSON' });
    return;
  }

  let request;
  try {
    request = IngestDeviceEvidenceRequestSchema.parse(rawBody);
  } catch (error) {
    if (error instanceof ZodError) {
      sendJson(res, 400, { error: 'invalid_request', issues: zodIssues(error) });
      return;
    }
    throw error;
  }

  try {
    const result = await service.ingestDeviceEvidence(sessionId, request);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 503, {
      error: 'device_bundle_not_configured',
      message: (error as Error).message,
    });
  }
}

async function handleIngestLinguisticEvidence(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  service: SessionOrchestrationService,
): Promise<void> {
  let rawBody: unknown;
  try {
    rawBody = await readJsonBody(req);
  } catch (error) {
    if (error instanceof HttpBodyTooLargeError) {
      sendJson(res, 413, { error: 'payload_too_large', message: error.message });
      return;
    }
    sendJson(res, 400, { error: 'invalid_json', message: 'Request body must be valid JSON' });
    return;
  }

  let request;
  try {
    request = IngestLinguisticEvidenceRequestSchema.parse(rawBody);
  } catch (error) {
    if (error instanceof ZodError) {
      sendJson(res, 400, { error: 'invalid_request', issues: zodIssues(error) });
      return;
    }
    throw error;
  }

  try {
    const result = await service.ingestLinguisticEvidence(sessionId, request);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 503, {
      error: 'linguistic_bundle_not_configured',
      message: (error as Error).message,
    });
  }
}

async function handleIngestElicitationEvidence(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  service: SessionOrchestrationService,
): Promise<void> {
  let rawBody: unknown;
  try {
    rawBody = await readJsonBody(req);
  } catch (error) {
    if (error instanceof HttpBodyTooLargeError) {
      sendJson(res, 413, { error: 'payload_too_large', message: error.message });
      return;
    }
    sendJson(res, 400, { error: 'invalid_json', message: 'Request body must be valid JSON' });
    return;
  }

  let request;
  try {
    request = IngestElicitationEvidenceRequestSchema.parse(rawBody);
  } catch (error) {
    if (error instanceof ZodError) {
      sendJson(res, 400, { error: 'invalid_request', issues: zodIssues(error) });
      return;
    }
    throw error;
  }

  try {
    const result = await service.ingestElicitationEvidence(sessionId, request);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 503, {
      error: 'elicitation_bundle_not_configured',
      message: (error as Error).message,
    });
  }
}

/**
 * Builds (but does not start listening on) the HTTP server. Splitting
 * construction from `listen()` keeps this trivially testable: tests can
 * bind to an ephemeral port (`listen(0)`) without any risk of colliding
 * with a real deployment's configured port.
 */
export function createHttpServer(service: SessionOrchestrationService, logger: Logger): Server {
  return createServer((req, res) => {
    void (async () => {
      const method = req.method ?? 'GET';
      const pathname = new URL(req.url ?? '/', 'http://internal').pathname;

      try {
        if (method === 'GET' && pathname === '/health') {
          sendJson(res, 200, { status: 'ok' });
          return;
        }

        const evidenceRoute = matchSessionRoute(pathname, 'evidence');
        if (evidenceRoute !== null) {
          if (method !== 'POST') {
            sendJson(res, 405, { error: 'method_not_allowed' });
            return;
          }
          await handleIngestEvidence(req, res, evidenceRoute.sessionId, service);
          return;
        }

        const visualAudioRoute = matchSessionRoute(pathname, 'visual-audio-evidence');
        if (visualAudioRoute !== null) {
          if (method !== 'POST') {
            sendJson(res, 405, { error: 'method_not_allowed' });
            return;
          }
          await handleIngestVisualAudioEvidence(req, res, visualAudioRoute.sessionId, service);
          return;
        }

        const deviceRoute = matchSessionRoute(pathname, 'device-evidence');
        if (deviceRoute !== null) {
          if (method !== 'POST') {
            sendJson(res, 405, { error: 'method_not_allowed' });
            return;
          }
          await handleIngestDeviceEvidence(req, res, deviceRoute.sessionId, service);
          return;
        }

        const linguisticRoute = matchSessionRoute(pathname, 'linguistic-evidence');
        if (linguisticRoute !== null) {
          if (method !== 'POST') {
            sendJson(res, 405, { error: 'method_not_allowed' });
            return;
          }
          await handleIngestLinguisticEvidence(req, res, linguisticRoute.sessionId, service);
          return;
        }

        const elicitationRoute = matchSessionRoute(pathname, 'elicitation-evidence');
        if (elicitationRoute !== null) {
          if (method !== 'POST') {
            sendJson(res, 405, { error: 'method_not_allowed' });
            return;
          }
          await handleIngestElicitationEvidence(req, res, elicitationRoute.sessionId, service);
          return;
        }

        const overrideRoute = matchSessionRoute(pathname, 'override');
        if (overrideRoute !== null) {
          if (method !== 'POST') {
            sendJson(res, 405, { error: 'method_not_allowed' });
            return;
          }
          await handleApplyHumanOverride(req, res, overrideRoute.sessionId, service);
          return;
        }

        const accommodationRoute = matchSessionRoute(pathname, 'accommodation-disclosure');
        if (accommodationRoute !== null) {
          if (method !== 'POST') {
            sendJson(res, 405, { error: 'method_not_allowed' });
            return;
          }
          await handleRecordAccommodationDisclosure(
            req,
            res,
            accommodationRoute.sessionId,
            service,
          );
          return;
        }

        const eventsRoute = matchSessionRoute(pathname, 'events');
        if (eventsRoute !== null) {
          if (method !== 'GET') {
            sendJson(res, 405, { error: 'method_not_allowed' });
            return;
          }
          handleSubscribeToSession(req, res, eventsRoute.sessionId, service);
          return;
        }

        const appealsRoute = matchSessionRoute(pathname, 'appeals');
        if (appealsRoute !== null) {
          if (method === 'POST') {
            await handleFileAppeal(req, res, appealsRoute.sessionId, service);
            return;
          }
          if (method === 'GET') {
            await handleListAppeals(res, appealsRoute.sessionId, service);
            return;
          }
          sendJson(res, 405, { error: 'method_not_allowed' });
          return;
        }

        const statusRoute = matchSessionRoute(pathname, 'status');
        if (statusRoute !== null) {
          if (method !== 'GET') {
            sendJson(res, 405, { error: 'method_not_allowed' });
            return;
          }
          await handleGetStatus(res, statusRoute.sessionId, service);
          return;
        }

        if (method === 'GET' && pathname === '/sessions/aggregate') {
          handleGetAggregateStatus(res, service);
          return;
        }

        sendJson(res, 404, { error: 'not_found' });
      } catch (error) {
        logger.error({ error, method, pathname }, 'unhandled API error');
        if (!res.headersSent) {
          sendJson(res, 500, { error: 'internal_error' });
        }
      }
    })();
  });
}
