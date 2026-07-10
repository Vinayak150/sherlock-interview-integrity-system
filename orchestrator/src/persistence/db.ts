import { Pool } from 'pg';
import type { PoolClient } from 'pg';

import type { DatabaseConfig } from '../config.js';

/**
 * The Evidence Store connection layer (RFC §9.3, ADR-7): one relational
 * database. Repositories and the migration runner depend on the narrow
 * `QueryExecutor`/`TransactionalExecutor` interfaces below, never on `pg`
 * directly — this is the Dependency Inversion seam that lets every other
 * persistence module (and their tests) stay decoupled from the concrete
 * driver.
 */

export interface QueryResultRow {
  [column: string]: unknown;
}

export interface QueryResult<Row extends QueryResultRow = QueryResultRow> {
  readonly rows: readonly Row[];
  readonly rowCount: number;
}

export interface QueryExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

/**
 * An executor that can additionally run a unit of work atomically. Kept as
 * a separate, wider interface (rather than folding `withTransaction` into
 * `QueryExecutor`) so components that never need transactions — the
 * repositories, today — only depend on the narrower interface they
 * actually use (Interface Segregation).
 */
export interface TransactionalExecutor extends QueryExecutor {
  withTransaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T>;
}

export interface DbPool extends TransactionalExecutor {
  close(): Promise<void>;
}

function toQueryExecutor(client: Pick<PoolClient, 'query'>): QueryExecutor {
  return {
    async query<Row extends QueryResultRow = QueryResultRow>(
      text: string,
      params: readonly unknown[] = [],
    ): Promise<QueryResult<Row>> {
      const result = await client.query(text, params as unknown[]);
      return { rows: (result.rows ?? []) as Row[], rowCount: result.rowCount ?? 0 };
    },
  };
}

/**
 * Builds the Evidence Store's connection pool from validated
 * `DatabaseConfig`. Kept as a thin, mockable wrapper around `pg.Pool` —
 * every non-trivial behavior (query mapping, transaction semantics) is
 * implemented here in plain, unit-testable functions rather than left
 * implicit inside the driver call sites.
 */
export function createDbPool(config: DatabaseConfig): DbPool {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
  });

  const poolExecutor = toQueryExecutor(pool);

  return {
    query: poolExecutor.query.bind(poolExecutor),

    async withTransaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const txExecutor = toQueryExecutor(client);
      try {
        await client.query('BEGIN');
        const result = await fn(txExecutor);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
