import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const connectMock = vi.fn();
const endMock = vi.fn();

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    query: queryMock,
    connect: connectMock,
    end: endMock,
  })),
}));

// Imported after vi.mock so the mocked module is in effect.
const { Pool } = await import('pg');
const { createDbPool } = await import('./db.js');
const { loadConfig } = await import('../config.js');

const config = loadConfig({
  POSTGRES_HOST: 'db.local',
  POSTGRES_PORT: '5433',
  POSTGRES_DB: 'sherlock_test',
  POSTGRES_USER: 'sherlock',
  POSTGRES_PASSWORD: 'secret',
}).database;

describe('createDbPool', () => {
  beforeEach(() => {
    queryMock.mockReset();
    connectMock.mockReset();
    endMock.mockReset();
    vi.mocked(Pool).mockClear();
  });

  it('constructs the underlying pg.Pool from the given database config', () => {
    createDbPool(config);

    expect(Pool).toHaveBeenCalledWith({
      host: 'db.local',
      port: 5433,
      database: 'sherlock_test',
      user: 'sherlock',
      password: 'secret',
    });
  });

  it('delegates query() to the pool and maps the raw pg result', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });
    const pool = createDbPool(config);

    const result = await pool.query('SELECT 1');

    expect(queryMock).toHaveBeenCalledWith('SELECT 1', []);
    expect(result).toEqual({ rows: [{ id: 1 }], rowCount: 1 });
  });

  it('defaults rowCount to 0 when the driver returns null/undefined', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: null });
    const pool = createDbPool(config);

    const result = await pool.query('SELECT 1 WHERE false');

    expect(result.rowCount).toBe(0);
  });

  it('runs withTransaction as BEGIN / fn / COMMIT and releases the client', async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const release = vi.fn();
    connectMock.mockResolvedValueOnce({ query: clientQuery, release });

    const pool = createDbPool(config);
    const result = await pool.withTransaction(async (tx) => {
      await tx.query('INSERT INTO t VALUES (1)');
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(clientQuery.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN',
      'INSERT INTO t VALUES (1)',
      'COMMIT',
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rolls back and releases the client when the transaction body throws', async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const release = vi.fn();
    connectMock.mockResolvedValueOnce({ query: clientQuery, release });

    const pool = createDbPool(config);

    await expect(
      pool.withTransaction(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(clientQuery.mock.calls.map((call) => call[0])).toEqual(['BEGIN', 'ROLLBACK']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases the client even if ROLLBACK itself fails', async () => {
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error('boom')) // the failing statement
      .mockRejectedValueOnce(new Error('rollback also failed')); // ROLLBACK
    const release = vi.fn();
    connectMock.mockResolvedValueOnce({ query: clientQuery, release });

    const pool = createDbPool(config);

    await expect(
      pool.withTransaction(async (tx) => {
        await tx.query('INSERT INTO t VALUES (1)');
      }),
    ).rejects.toThrow('boom');

    expect(release).toHaveBeenCalledTimes(1);
  });

  it('closes the underlying pool', async () => {
    const pool = createDbPool(config);
    await pool.close();

    expect(endMock).toHaveBeenCalledTimes(1);
  });
});
