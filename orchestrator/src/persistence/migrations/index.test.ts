import { describe, expect, it } from 'vitest';

import type { QueryExecutor, TransactionalExecutor } from '../db.js';
import { runMigrations } from '../migrationRunner.js';
import { MIGRATIONS } from './index.js';

/**
 * Exercises the real, shipped migration set (not a synthetic one) through
 * the runner, against a fake executor that just records which SQL bodies
 * ran — enough to prove the actual `evidence_events` and
 * `session_state_snapshots` migrations are well-formed, uniquely
 * identified, in order, and idempotent, without requiring a live Postgres
 * instance for this fast unit test. `integration.test.ts` (opt-in) proves
 * the same SQL is valid against real Postgres.
 */
function createFakeDb(): { db: TransactionalExecutor; ranSql: string[] } {
  const appliedIds = new Set<string>();
  const ranSql: string[] = [];

  const executor: QueryExecutor = {
    async query<Row>(text: string, params: readonly unknown[] = []) {
      if (text.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
        return { rows: [] as Row[], rowCount: 0 };
      }
      if (text.includes('SELECT id FROM schema_migrations')) {
        const rows = Array.from(appliedIds, (id) => ({ id })) as Row[];
        return { rows, rowCount: rows.length };
      }
      if (text.startsWith('INSERT INTO schema_migrations')) {
        appliedIds.add(params[0] as string);
        return { rows: [] as Row[], rowCount: 1 };
      }
      ranSql.push(text);
      return { rows: [] as Row[], rowCount: 0 };
    },
  };

  return {
    db: {
      query: executor.query,
      async withTransaction(fn) {
        return fn(executor);
      },
    },
    ranSql,
  };
}

describe('MIGRATIONS (Evidence Store schema, RFC §9.3)', () => {
  it('contains exactly the evidence-events and session-state-snapshots migrations, in order', () => {
    expect(MIGRATIONS.map((migration) => migration.id)).toEqual([
      '0001_create_evidence_events',
      '0002_create_session_state_snapshots',
    ]);
  });

  it('applies cleanly and idempotently through the migration runner', async () => {
    const { db, ranSql } = createFakeDb();

    const firstRun = await runMigrations(db, MIGRATIONS);
    expect(firstRun).toEqual(MIGRATIONS.map((migration) => migration.id));
    expect(ranSql).toHaveLength(MIGRATIONS.length);

    const secondRun = await runMigrations(db, MIGRATIONS);
    expect(secondRun).toEqual([]);
  });

  it('creates the evidence_events table with the columns the repository depends on', () => {
    const migration = MIGRATIONS.find((m) => m.id === '0001_create_evidence_events');
    expect(migration?.sql).toMatch(/CREATE TABLE IF NOT EXISTS evidence_events/);
    for (const column of [
      'id',
      'session_id',
      'bundle',
      'signal_name',
      'health_status',
      'value',
      'metadata',
      'occurred_at',
      'recorded_at',
    ]) {
      expect(migration?.sql).toContain(column);
    }
  });

  it('creates the session_state_snapshots table with a unique (session_id, sequence) constraint', () => {
    const migration = MIGRATIONS.find((m) => m.id === '0002_create_session_state_snapshots');
    expect(migration?.sql).toMatch(/CREATE TABLE IF NOT EXISTS session_state_snapshots/);
    expect(migration?.sql).toMatch(/UNIQUE \(session_id, sequence\)/);
  });
});
