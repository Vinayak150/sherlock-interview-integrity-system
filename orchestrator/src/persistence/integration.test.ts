import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import type { DbPool } from './db.js';
import { createDbPool } from './db.js';
import { PostgresEvidenceEventRepository } from './evidenceEventRepository.js';
import { runMigrations } from './migrationRunner.js';
import { MIGRATIONS } from './migrations/index.js';
import { PostgresSessionSnapshotRepository } from './sessionSnapshotRepository.js';

/**
 * Opt-in end-to-end coverage against a real Postgres instance.
 *
 * The rest of this module's tests use fakes/mocks deliberately — they run
 * everywhere, fast, with no external dependency. This suite exists because
 * a fake `QueryExecutor` cannot, by construction, prove the actual SQL in
 * `migrations/` is valid or that the real driver's JSONB/timestamptz
 * round-tripping behaves as assumed. It is skipped unless
 * `RUN_DB_INTEGRATION_TESTS=true` and a reachable Postgres is configured
 * (see `docker-compose.yml`'s `postgres` service and
 * `.github/workflows/ci.yml`, which sets both in CI).
 */
const RUN_INTEGRATION_TESTS = process.env.RUN_DB_INTEGRATION_TESTS === 'true';

describe.skipIf(!RUN_INTEGRATION_TESTS)('Evidence Store — Postgres integration (opt-in)', () => {
  let pool: DbPool;

  beforeAll(async () => {
    pool = createDbPool(loadConfig().database);
    await runMigrations(pool, MIGRATIONS);
  });

  afterAll(async () => {
    await pool?.close();
  });

  it('is idempotent when migrations are run a second time', async () => {
    const applied = await runMigrations(pool, MIGRATIONS);
    expect(applied).toEqual([]);
  });

  it('persists and retrieves an evidence event end-to-end', async () => {
    const repo = new PostgresEvidenceEventRepository(pool);
    const sessionId = `itest-evidence-${Date.now()}`;

    const persisted = await repo.append({
      sessionId,
      bundle: 'visual',
      signalName: 'face_embedding_self_consistency',
      healthStatus: 'OK',
      value: { similarity: 0.87 },
      metadata: { source: 'integration-test' },
      occurredAt: new Date(),
    });

    const events = await repo.listBySession(sessionId);

    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe(persisted.id);
    expect(events[0]?.value).toEqual({ similarity: 0.87 });
    expect(events[0]?.metadata).toEqual({ source: 'integration-test' });
    expect(events[0]?.occurredAt).toBeInstanceOf(Date);
  });

  it('records SERVICE_UNAVAILABLE and NO_SIGNAL_DETECTED events with a null value', async () => {
    const repo = new PostgresEvidenceEventRepository(pool);
    const sessionId = `itest-health-${Date.now()}`;

    await repo.append({
      sessionId,
      bundle: 'audio',
      signalName: 'voice_embedding_self_consistency',
      healthStatus: 'SERVICE_UNAVAILABLE',
      value: null,
      metadata: null,
      occurredAt: new Date(),
    });

    const events = await repo.listBySession(sessionId);
    expect(events[0]?.healthStatus).toBe('SERVICE_UNAVAILABLE');
    expect(events[0]?.value).toBeNull();
  });

  it('persists and retrieves the latest session state snapshot end-to-end', async () => {
    const repo = new PostgresSessionSnapshotRepository(pool);
    const sessionId = `itest-snapshot-${Date.now()}`;

    await repo.save({ sessionId, sequence: 0, state: { logOdds: 0 } });
    await repo.save({ sessionId, sequence: 1, state: { logOdds: 0.42 } });

    const latest = await repo.getLatest(sessionId);

    expect(latest?.sequence).toBe(1);
    expect(latest?.state).toEqual({ logOdds: 0.42 });
  });

  it('rejects a duplicate (session_id, sequence) snapshot', async () => {
    const repo = new PostgresSessionSnapshotRepository(pool);
    const sessionId = `itest-dup-${Date.now()}`;

    await repo.save({ sessionId, sequence: 0, state: {} });

    await expect(repo.save({ sessionId, sequence: 0, state: {} })).rejects.toThrow(
      /already exists/,
    );
  });
});
