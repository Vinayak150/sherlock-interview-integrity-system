import { CONTRACTS_PACKAGE_NAME } from '@sherlock/contracts';

import { SessionOrchestrationService, createHttpServer } from './api/index.js';
import { SessionEventBus } from './api/sessionEventBus.js';
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
import { loadConfig } from './config.js';
import { DecisionEngine } from './decision/index.js';
import { ExplanationEngine, LlmNarrativeAdapter, StubLlmProvider } from './explanation/index.js';
import { ChangePointDetector, FusionEngine } from './fusion/index.js';
import { createLogger } from './logger.js';
import { HttpModelServingClient } from './modelserving_client/index.js';
import {
  InMemoryAccommodationDisclosureRepository,
  PostgresEvidenceEventRepository,
  PostgresSessionSnapshotRepository,
  createDbPool,
} from './persistence/index.js';
import { SessionLifecycleStore } from './routing/index.js';
import {
  EncryptingEvidenceEventRepository,
  InMemoryAppealRepository,
  InMemoryAuditLogRepository,
} from './security/index.js';
import { LifecycleStateManager } from './statemachine/index.js';

/**
 * Orchestrator entrypoint.
 *
 * M0 proved the process starts, reads its environment, and shuts down
 * cleanly, with no domain modules loaded. M7/M8 wired the full M2-M6
 * pipeline behind a real, listening HTTP surface. M9 adds the Visual/Audio
 * bundles, calling the real (stub-backed) Model-Serving Layer over HTTP.
 *
 * Two things this wiring deliberately does *not* do, both for honest,
 * stated reasons rather than oversight:
 *
 * - It does not run database migrations (`make migrate` / `npm run
 *   migrate` remains the only way schema gets applied — this was already
 *   M1's stated policy, unchanged here).
 * - It does not construct a `SessionRouter`/`SessionRegistry`. RFC §9.4's
 *   own final decision places routing *enforcement* at the load balancer,
 *   consulting the registry — not inside the orchestrator process itself.
 *   A single-instance `docker-compose` topology has exactly one replica,
 *   so there is no routing decision to make yet. `routing/`'s
 *   `SessionRouter`/`ConsistentHashRing`/`SessionRegistry` are fully built
 *   and tested (Plan M7) as the building blocks a real load
 *   balancer/ingress would consult once this deployment actually runs
 *   multiple replicas (RFC §16's phased-infrastructure philosophy,
 *   ADR-14) — wiring them into a single-replica entrypoint now would be
 *   dead code, not a real integration.
 *
 * Also honest and stated: no real ATS/scheduling integration exists yet
 * (Plan M2's `InMemoryAtsClient` is explicitly a stub) — every Claim
 * Bundle lookup will report `SERVICE_UNAVAILABLE` until a real client is
 * wired in. The system already handles that gracefully by design (RFC
 * §13); it is logged loudly here so it is never mistaken for a working
 * integration in a real deployment.
 */
function main(): void {
  const config = loadConfig();
  const logger = createLogger(config);

  logger.info(
    { nodeEnv: config.nodeEnv, contracts: CONTRACTS_PACKAGE_NAME, replicaId: config.replicaId },
    'orchestrator starting',
  );

  const dbPool = createDbPool(config.database);
  // RFC §15/Pilot-readiness bar; Plan M16: encryption at rest for the Visual/Audio bundles'
  // biometric-derived values. `PostgresEvidenceEventRepository` itself is untouched -- this
  // wraps it, so the encryption boundary is exactly this one line, not a change scattered
  // across the persistence layer.
  const evidenceRepository = new EncryptingEvidenceEventRepository(
    new PostgresEvidenceEventRepository(dbPool),
    config.security.fieldEncryptionKey,
  );
  const snapshotRepository = new PostgresSessionSnapshotRepository(dbPool);

  logger.warn(
    'no real ATS/scheduling integration is configured -- the Claim Bundle Adapter will report every candidate lookup as SERVICE_UNAVAILABLE until one is wired in (see src/bundles/claim/atsClient.ts)',
  );
  const claimAdapter = new ClaimBundleAdapter(new InMemoryAtsClient());
  const metadataAdapter = new MetadataBundleAdapter();

  logger.warn(
    { modelServingUrl: config.modelServing.baseUrl },
    'the Model-Serving Layer is served behind stub embedding/liveness implementations -- no real biometric model is loaded (see model-serving/src/model_serving/embeddings, .../liveness)',
  );
  const modelServingClient = new HttpModelServingClient({ baseUrl: config.modelServing.baseUrl });
  const consistencyTracker = new EmbeddingSelfConsistencyTracker();
  const changePointDetector = new ChangePointDetector();
  const visualAdapter = new VisualBundleAdapter(
    modelServingClient,
    consistencyTracker,
    changePointDetector,
  );
  const audioAdapter = new AudioBundleAdapter(
    modelServingClient,
    consistencyTracker,
    changePointDetector,
  );
  const deviceAdapter = new DeviceBundleAdapter();
  const linguisticAdapter = new LinguisticBundleAdapter();
  const elicitationAdapter = new ElicitationBundleAdapter();

  const fusionEngine = new FusionEngine();
  const lifecycleStore = new SessionLifecycleStore(new LifecycleStateManager(), snapshotRepository);
  const decisionEngine = new DecisionEngine();
  const explanationEngine = new ExplanationEngine();

  logger.warn(
    'no real LLM provider is configured -- the narrative layer is served behind a deterministic template, not a real model (see src/explanation/llmProvider.ts)',
  );
  const llmNarrativeAdapter = new LlmNarrativeAdapter(new StubLlmProvider());

  // Plan M13: dashboard-facing additions. `AccommodationDisclosureRepository` is in-memory only
  // for now (see that module's own doc comment on this stated scope limitation); the aggregate
  // view and event bus are both explicitly single-replica in scope (see their own doc comments).
  const accommodationDisclosureRepository = new InMemoryAccommodationDisclosureRepository();
  const sessionEventBus = new SessionEventBus();

  // Plan M16: audit-log coverage for every biometric-evidence view, and the candidate appeal
  // flow. Both in-memory only -- see their own modules' doc comments for this stated scope
  // limitation (no Postgres-backed implementation, no real authentication system to attribute
  // `viewedBy` to a verified principal).
  logger.info(
    { dataResidencyRegion: config.security.dataResidencyRegion },
    'data residency region configured',
  );
  const auditLogRepository = new InMemoryAuditLogRepository();
  const appealRepository = new InMemoryAppealRepository();

  const orchestrationService = new SessionOrchestrationService(
    claimAdapter,
    metadataAdapter,
    evidenceRepository,
    fusionEngine,
    lifecycleStore,
    decisionEngine,
    explanationEngine,
    visualAdapter,
    audioAdapter,
    deviceAdapter,
    linguisticAdapter,
    elicitationAdapter,
    llmNarrativeAdapter,
    accommodationDisclosureRepository,
    sessionEventBus,
    auditLogRepository,
    appealRepository,
  );

  const httpServer = createHttpServer(orchestrationService, logger);
  httpServer.listen(config.http.port, config.http.host, () => {
    logger.info({ port: config.http.port, host: config.http.host }, 'API layer listening');
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'orchestrator shutting down');
    httpServer.close(() => {
      dbPool
        .close()
        .catch((error: unknown) =>
          logger.error({ error }, 'error closing Evidence Store connection pool'),
        )
        .finally(() => process.exit(0));
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
