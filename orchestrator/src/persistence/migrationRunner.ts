import type { TransactionalExecutor } from './db.js';

/**
 * A single, idempotent, forward-only schema migration. Migration bodies are
 * embedded as TypeScript string constants (see `migrations/`) rather than
 * loose `.sql` files on disk, so the compiled `dist/` output is always
 * complete and self-contained — no separate asset-copy build step, no risk
 * of a migration silently missing from a deployed image.
 */
export interface Migration {
  readonly id: string;
  readonly sql: string;
}

const ENSURE_SCHEMA_MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

/**
 * Validates the migration set's own invariants before touching the
 * database: no duplicate ids, and supplied in the order they must be
 * applied (ascending, lexicographic by id — the numeric prefix convention
 * used under `migrations/`). Catching a misordered or duplicated migration
 * here, at call time, is far cheaper than discovering it against a real
 * database.
 */
function assertWellFormedMigrations(migrations: readonly Migration[]): void {
  const seenIds = new Set<string>();

  for (const migration of migrations) {
    if (migration.id.trim() === '') {
      throw new Error('Migration id must be a non-empty string');
    }
    if (seenIds.has(migration.id)) {
      throw new Error(`Duplicate migration id: ${migration.id}`);
    }
    seenIds.add(migration.id);
  }

  const sortedIds = migrations.map((migration) => migration.id).sort((a, b) => a.localeCompare(b));
  const suppliedIds = migrations.map((migration) => migration.id);
  const isAscending = sortedIds.every((id, index) => id === suppliedIds[index]);
  if (!isAscending) {
    throw new Error('Migrations must be supplied in ascending id order');
  }
}

/**
 * Applies every migration in `migrations` that has not yet been recorded in
 * `schema_migrations`, each inside its own transaction (schema change +
 * bookkeeping insert, atomically) so a crash mid-migration never leaves a
 * migration half-applied-but-unrecorded, or recorded-but-not-applied.
 *
 * Returns the ids of migrations newly applied by this call (empty on a
 * second, idempotent run against an already-up-to-date database).
 */
export async function runMigrations(
  db: TransactionalExecutor,
  migrations: readonly Migration[],
): Promise<readonly string[]> {
  assertWellFormedMigrations(migrations);

  await db.query(ENSURE_SCHEMA_MIGRATIONS_TABLE_SQL);

  const appliedRows = await db.query<{ id: string }>('SELECT id FROM schema_migrations');
  const appliedIds = new Set(appliedRows.rows.map((row) => row.id));

  const pending = migrations.filter((migration) => !appliedIds.has(migration.id));
  const newlyApplied: string[] = [];

  for (const migration of pending) {
    await db.withTransaction(async (tx) => {
      await tx.query(migration.sql);
      await tx.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
    });
    newlyApplied.push(migration.id);
  }

  return newlyApplied;
}
