import { describe, expect, it } from 'vitest';

import type { QueryExecutor, TransactionalExecutor } from './db.js';
import type { Migration } from './migrationRunner.js';
import { runMigrations } from './migrationRunner.js';

/**
 * A minimal fake `TransactionalExecutor` that understands only the exact
 * queries `runMigrations` is documented to issue — enough to unit-test the
 * runner's control flow (apply-once, ordering, idempotence) without a real
 * database.
 */
function createFakeDb(initiallyAppliedIds: readonly string[] = []): {
  db: TransactionalExecutor;
  appliedIds: () => readonly string[];
  migrationSqlRun: string[];
} {
  const appliedIds = new Set(initiallyAppliedIds);
  const migrationSqlRun: string[] = [];

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
      migrationSqlRun.push(text);
      return { rows: [] as Row[], rowCount: 0 };
    },
  };

  const db: TransactionalExecutor = {
    query: executor.query,
    async withTransaction(fn) {
      return fn(executor);
    },
  };

  return { db, appliedIds: () => [...appliedIds], migrationSqlRun };
}

describe('runMigrations', () => {
  const migrationA: Migration = { id: '0001_a', sql: 'CREATE TABLE a (id INT)' };
  const migrationB: Migration = { id: '0002_b', sql: 'CREATE TABLE b (id INT)' };

  it('applies all pending migrations in order and records them', async () => {
    const { db, appliedIds, migrationSqlRun } = createFakeDb();

    const applied = await runMigrations(db, [migrationA, migrationB]);

    expect(applied).toEqual(['0001_a', '0002_b']);
    expect(appliedIds()).toEqual(['0001_a', '0002_b']);
    expect(migrationSqlRun).toEqual([migrationA.sql, migrationB.sql]);
  });

  it('is idempotent: a second run against an up-to-date database applies nothing', async () => {
    const { db } = createFakeDb();
    await runMigrations(db, [migrationA, migrationB]);

    const secondRun = await runMigrations(db, [migrationA, migrationB]);

    expect(secondRun).toEqual([]);
  });

  it('applies only the migrations not already recorded', async () => {
    const { db } = createFakeDb(['0001_a']);

    const applied = await runMigrations(db, [migrationA, migrationB]);

    expect(applied).toEqual(['0002_b']);
  });

  it('rejects a duplicate migration id before touching the database', async () => {
    const { db, migrationSqlRun } = createFakeDb();

    await expect(runMigrations(db, [migrationA, migrationA])).rejects.toThrow(
      /Duplicate migration id/,
    );
    expect(migrationSqlRun).toEqual([]);
  });

  it('rejects migrations supplied out of ascending id order', async () => {
    const { db } = createFakeDb();

    await expect(runMigrations(db, [migrationB, migrationA])).rejects.toThrow(/ascending id order/);
  });

  it('rejects a migration with an empty id', async () => {
    const { db } = createFakeDb();

    await expect(runMigrations(db, [{ id: '   ', sql: 'SELECT 1' }])).rejects.toThrow(
      /non-empty string/,
    );
  });

  it('accepts an empty migration list as a no-op', async () => {
    const { db } = createFakeDb();

    await expect(runMigrations(db, [])).resolves.toEqual([]);
  });
});
