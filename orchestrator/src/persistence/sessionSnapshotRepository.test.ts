import type { NewSessionStateSnapshot } from '@sherlock/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { QueryExecutor } from './db.js';
import { EvidencePersistenceValidationError, EvidenceStoreError } from './errors.js';
import {
  InMemorySessionSnapshotRepository,
  PostgresSessionSnapshotRepository,
} from './sessionSnapshotRepository.js';

function newSnapshot(overrides: Partial<NewSessionStateSnapshot> = {}): NewSessionStateSnapshot {
  return {
    sessionId: 'session-1',
    sequence: 0,
    state: { logOdds: 0 },
    ...overrides,
  };
}

function createFakeDb(): { db: QueryExecutor; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn();
  return { db: { query }, query };
}

describe('PostgresSessionSnapshotRepository', () => {
  describe('save', () => {
    it('inserts a valid snapshot and maps the returned row back', async () => {
      const { db, query } = createFakeDb();
      query.mockResolvedValueOnce({
        rows: [
          {
            id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
            session_id: 'session-1',
            sequence: 0,
            state: { logOdds: 0 },
            created_at: new Date('2026-07-10T12:00:00.000Z'),
          },
        ],
        rowCount: 1,
      });

      const repo = new PostgresSessionSnapshotRepository(db);
      const persisted = await repo.save(newSnapshot());

      expect(persisted.id).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
      expect(persisted.sequence).toBe(0);
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('rejects a negative sequence without querying the database', async () => {
      const { db, query } = createFakeDb();
      const repo = new PostgresSessionSnapshotRepository(db);

      await expect(repo.save(newSnapshot({ sequence: -1 }))).rejects.toBeInstanceOf(
        EvidencePersistenceValidationError,
      );
      expect(query).not.toHaveBeenCalled();
    });

    it('wraps a Postgres unique-violation as a descriptive EvidenceStoreError', async () => {
      const { db, query } = createFakeDb();
      query.mockRejectedValueOnce({ code: '23505', message: 'duplicate key value' });
      const repo = new PostgresSessionSnapshotRepository(db);

      await expect(repo.save(newSnapshot())).rejects.toThrow(/already exists/);
    });

    it('wraps an unexpected database failure in EvidenceStoreError', async () => {
      const { db, query } = createFakeDb();
      query.mockRejectedValueOnce(new Error('connection refused'));
      const repo = new PostgresSessionSnapshotRepository(db);

      await expect(repo.save(newSnapshot())).rejects.toBeInstanceOf(EvidenceStoreError);
    });

    it('raises EvidenceStoreError when the insert returns no row', async () => {
      const { db, query } = createFakeDb();
      query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new PostgresSessionSnapshotRepository(db);

      await expect(repo.save(newSnapshot())).rejects.toBeInstanceOf(EvidenceStoreError);
    });
  });

  describe('getLatest', () => {
    it('returns null when no snapshot exists for the session', async () => {
      const { db, query } = createFakeDb();
      query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new PostgresSessionSnapshotRepository(db);

      await expect(repo.getLatest('session-1')).resolves.toBeNull();
    });

    it('queries ordered by sequence descending, limited to one row', async () => {
      const { db, query } = createFakeDb();
      query.mockResolvedValueOnce({
        rows: [
          {
            id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
            session_id: 'session-1',
            sequence: 4,
            state: { logOdds: 1.2 },
            created_at: new Date('2026-07-10T12:00:00.000Z'),
          },
        ],
        rowCount: 1,
      });

      const repo = new PostgresSessionSnapshotRepository(db);
      const latest = await repo.getLatest('session-1');

      expect(latest?.sequence).toBe(4);
      expect(query.mock.calls[0]?.[0]).toMatch(/ORDER BY sequence DESC/);
    });

    it('rejects an empty sessionId without querying', async () => {
      const { db, query } = createFakeDb();
      const repo = new PostgresSessionSnapshotRepository(db);

      await expect(repo.getLatest('  ')).rejects.toBeInstanceOf(EvidencePersistenceValidationError);
      expect(query).not.toHaveBeenCalled();
    });

    it('wraps an unexpected database failure in EvidenceStoreError', async () => {
      const { db, query } = createFakeDb();
      query.mockRejectedValueOnce(new Error('timeout'));
      const repo = new PostgresSessionSnapshotRepository(db);

      await expect(repo.getLatest('session-1')).rejects.toBeInstanceOf(EvidenceStoreError);
    });
  });
});

describe('InMemorySessionSnapshotRepository', () => {
  it('returns the highest-sequence snapshot as latest, regardless of insertion order', async () => {
    const repo = new InMemorySessionSnapshotRepository();
    await repo.save(newSnapshot({ sequence: 0 }));
    await repo.save(newSnapshot({ sequence: 2 }));
    await repo.save(newSnapshot({ sequence: 1 }));

    const latest = await repo.getLatest('session-1');

    expect(latest?.sequence).toBe(2);
  });

  it('rejects a duplicate sequence for the same session', async () => {
    const repo = new InMemorySessionSnapshotRepository();
    await repo.save(newSnapshot({ sequence: 0 }));

    await expect(repo.save(newSnapshot({ sequence: 0 }))).rejects.toBeInstanceOf(
      EvidenceStoreError,
    );
  });

  it('keeps snapshot sequences isolated per session', async () => {
    const repo = new InMemorySessionSnapshotRepository();
    await repo.save(newSnapshot({ sessionId: 'session-a', sequence: 0 }));
    await repo.save(newSnapshot({ sessionId: 'session-b', sequence: 0 }));

    await expect(repo.getLatest('session-a')).resolves.toMatchObject({ sessionId: 'session-a' });
    await expect(repo.getLatest('session-b')).resolves.toMatchObject({ sessionId: 'session-b' });
  });

  it('returns null for a session with no snapshots', async () => {
    const repo = new InMemorySessionSnapshotRepository();

    await expect(repo.getLatest('unknown-session')).resolves.toBeNull();
  });

  it('rejects an invalid snapshot', async () => {
    const repo = new InMemorySessionSnapshotRepository();

    await expect(repo.save(newSnapshot({ sessionId: '' }))).rejects.toBeInstanceOf(
      EvidencePersistenceValidationError,
    );
  });

  it('rejects getLatest for an empty sessionId', async () => {
    const repo = new InMemorySessionSnapshotRepository();

    await expect(repo.getLatest('')).rejects.toBeInstanceOf(EvidencePersistenceValidationError);
  });
});
