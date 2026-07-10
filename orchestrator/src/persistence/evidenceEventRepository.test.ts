import type { NewEvidenceEvent } from '@sherlock/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { QueryExecutor } from './db.js';
import {
  InMemoryEvidenceEventRepository,
  PostgresEvidenceEventRepository,
} from './evidenceEventRepository.js';
import { EvidencePersistenceValidationError, EvidenceStoreError } from './errors.js';

function newEvent(overrides: Partial<NewEvidenceEvent> = {}): NewEvidenceEvent {
  return {
    sessionId: 'session-1',
    bundle: 'visual',
    signalName: 'face_embedding_self_consistency',
    healthStatus: 'OK',
    value: { similarity: 0.91 },
    metadata: null,
    occurredAt: new Date('2026-07-10T12:00:00.000Z'),
    ...overrides,
  };
}

function createFakeDb(): { db: QueryExecutor; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn();
  return { db: { query }, query };
}

describe('PostgresEvidenceEventRepository', () => {
  describe('append', () => {
    it('inserts a valid event and maps the returned row back to an EvidenceEvent', async () => {
      const { db, query } = createFakeDb();
      query.mockResolvedValueOnce({
        rows: [
          {
            id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
            session_id: 'session-1',
            bundle: 'visual',
            signal_name: 'face_embedding_self_consistency',
            health_status: 'OK',
            value: { similarity: 0.91 },
            metadata: null,
            occurred_at: new Date('2026-07-10T12:00:00.000Z'),
            recorded_at: new Date('2026-07-10T12:00:00.250Z'),
          },
        ],
        rowCount: 1,
      });

      const repo = new PostgresEvidenceEventRepository(db);
      const persisted = await repo.append(newEvent());

      expect(persisted.id).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
      expect(persisted.sessionId).toBe('session-1');
      expect(persisted.value).toEqual({ similarity: 0.91 });

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/INSERT INTO evidence_events/);
      expect(params[1]).toBe('session-1');
      expect(params[2]).toBe('visual');
    });

    it('rejects an event with an empty sessionId without querying the database', async () => {
      const { db, query } = createFakeDb();
      const repo = new PostgresEvidenceEventRepository(db);

      await expect(repo.append(newEvent({ sessionId: '  ' }))).rejects.toBeInstanceOf(
        EvidencePersistenceValidationError,
      );
      expect(query).not.toHaveBeenCalled();
    });

    it('rejects an event with an unrecognized bundle name', async () => {
      const { db, query } = createFakeDb();
      const repo = new PostgresEvidenceEventRepository(db);

      await expect(repo.append(newEvent({ bundle: 'video' as never }))).rejects.toBeInstanceOf(
        EvidencePersistenceValidationError,
      );
      expect(query).not.toHaveBeenCalled();
    });

    it('wraps an unexpected database failure in EvidenceStoreError', async () => {
      const { db, query } = createFakeDb();
      query.mockRejectedValueOnce(new Error('connection refused'));
      const repo = new PostgresEvidenceEventRepository(db);

      await expect(repo.append(newEvent())).rejects.toBeInstanceOf(EvidenceStoreError);
    });

    it('raises EvidenceStoreError when the insert returns no row', async () => {
      const { db, query } = createFakeDb();
      query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new PostgresEvidenceEventRepository(db);

      await expect(repo.append(newEvent())).rejects.toBeInstanceOf(EvidenceStoreError);
    });
  });

  describe('listBySession', () => {
    it('queries by session and maps every row, defaulting to the standard limit', async () => {
      const { db, query } = createFakeDb();
      query.mockResolvedValueOnce({
        rows: [
          {
            id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
            session_id: 'session-1',
            bundle: 'visual',
            signal_name: 'x',
            health_status: 'OK',
            value: null,
            metadata: null,
            occurred_at: new Date('2026-07-10T12:00:00.000Z'),
            recorded_at: new Date('2026-07-10T12:00:00.100Z'),
          },
        ],
        rowCount: 1,
      });

      const repo = new PostgresEvidenceEventRepository(db);
      const events = await repo.listBySession('session-1');

      expect(events).toHaveLength(1);
      expect(query.mock.calls[0]?.[1]).toEqual(['session-1', 500]);
    });

    it('rejects an empty sessionId without querying', async () => {
      const { db, query } = createFakeDb();
      const repo = new PostgresEvidenceEventRepository(db);

      await expect(repo.listBySession('   ')).rejects.toBeInstanceOf(
        EvidencePersistenceValidationError,
      );
      expect(query).not.toHaveBeenCalled();
    });

    it('rejects a non-positive limit', async () => {
      const { db, query } = createFakeDb();
      const repo = new PostgresEvidenceEventRepository(db);

      await expect(repo.listBySession('session-1', { limit: 0 })).rejects.toBeInstanceOf(
        EvidencePersistenceValidationError,
      );
      expect(query).not.toHaveBeenCalled();
    });

    it('clamps a limit above the maximum', async () => {
      const { db, query } = createFakeDb();
      query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const repo = new PostgresEvidenceEventRepository(db);

      await repo.listBySession('session-1', { limit: 999_999 });

      expect(query.mock.calls[0]?.[1]).toEqual(['session-1', 5000]);
    });

    it('wraps an unexpected database failure in EvidenceStoreError', async () => {
      const { db, query } = createFakeDb();
      query.mockRejectedValueOnce(new Error('timeout'));
      const repo = new PostgresEvidenceEventRepository(db);

      await expect(repo.listBySession('session-1')).rejects.toBeInstanceOf(EvidenceStoreError);
    });
  });
});

describe('InMemoryEvidenceEventRepository', () => {
  it('appends and lists events for a session in occurred_at order, isolated per session', async () => {
    const repo = new InMemoryEvidenceEventRepository();
    await repo.append(newEvent({ occurredAt: new Date('2026-07-10T12:00:02.000Z') }));
    await repo.append(newEvent({ occurredAt: new Date('2026-07-10T12:00:00.000Z') }));
    await repo.append(newEvent({ sessionId: 'other-session' }));

    const events = await repo.listBySession('session-1');

    expect(events).toHaveLength(2);
    expect(events[0]?.occurredAt.toISOString()).toBe('2026-07-10T12:00:00.000Z');
    expect(events[1]?.occurredAt.toISOString()).toBe('2026-07-10T12:00:02.000Z');
  });

  it('assigns a unique id and a recordedAt write-timestamp to every appended event', async () => {
    const repo = new InMemoryEvidenceEventRepository();
    const a = await repo.append(newEvent());
    const b = await repo.append(newEvent());

    expect(a.id).not.toBe(b.id);
    expect(a.recordedAt).toBeInstanceOf(Date);
  });

  it('rejects an invalid event', async () => {
    const repo = new InMemoryEvidenceEventRepository();

    await expect(repo.append(newEvent({ bundle: 'video' as never }))).rejects.toBeInstanceOf(
      EvidencePersistenceValidationError,
    );
  });

  it('rejects listBySession for an empty sessionId', async () => {
    const repo = new InMemoryEvidenceEventRepository();

    await expect(repo.listBySession('')).rejects.toBeInstanceOf(EvidencePersistenceValidationError);
  });

  it('respects the limit option', async () => {
    const repo = new InMemoryEvidenceEventRepository();
    for (let i = 0; i < 3; i += 1) {
      await repo.append(newEvent({ occurredAt: new Date(Date.UTC(2026, 6, 10, 12, 0, i)) }));
    }

    const events = await repo.listBySession('session-1', { limit: 2 });

    expect(events).toHaveLength(2);
  });
});
