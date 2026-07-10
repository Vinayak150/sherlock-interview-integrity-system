/**
 * Public surface of the Evidence Store persistence module (RFC §9.3,
 * ADR-7; Plan M1). Other orchestrator modules (Fusion Engine, M3+;
 * recovery/routing, M7) should import repositories and connection
 * management from this barrel rather than reaching into individual files.
 */
export type {
  DbPool,
  QueryExecutor,
  QueryResult,
  QueryResultRow,
  TransactionalExecutor,
} from './db.js';
export { createDbPool } from './db.js';

export { EvidencePersistenceValidationError, EvidenceStoreError } from './errors.js';

export type { Migration } from './migrationRunner.js';
export { runMigrations } from './migrationRunner.js';
export { MIGRATIONS } from './migrations/index.js';

export type { EvidenceEventRepository } from './evidenceEventRepository.js';
export {
  InMemoryEvidenceEventRepository,
  PostgresEvidenceEventRepository,
} from './evidenceEventRepository.js';

export type { SessionSnapshotRepository } from './sessionSnapshotRepository.js';
export {
  InMemorySessionSnapshotRepository,
  PostgresSessionSnapshotRepository,
} from './sessionSnapshotRepository.js';
