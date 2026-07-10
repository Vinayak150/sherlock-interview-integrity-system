/**
 * Public surface of the API layer (Plan §5 repository structure
 * `orchestrator/api/`; this batch's "M8 — External Interfaces/API
 * Layer"). Thin by design: request/response translation and
 * orchestration sequencing only. See `sessionOrchestrationService.ts`'s
 * and `httpServer.ts`'s doc comments for the exact ownership boundary.
 */
export type {
  IngestEvidenceRequest,
  ObservedIdentityClaimRequest,
  SessionJoinMetadataRequest,
} from './schemas.js';
export {
  IngestEvidenceRequestSchema,
  ObservedIdentityClaimRequestSchema,
  SessionJoinMetadataRequestSchema,
} from './schemas.js';

export type { IngestEvidenceResult, SessionStatus } from './sessionOrchestrationService.js';
export { SessionOrchestrationService } from './sessionOrchestrationService.js';

export { createHttpServer } from './httpServer.js';
