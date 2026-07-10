import { randomUUID } from 'node:crypto';

import { NewSessionStateSnapshotSchema, SessionStateSnapshotSchema } from '@sherlock/contracts';
import type { NewSessionStateSnapshot, SessionStateSnapshot } from '@sherlock/contracts';

import type { QueryExecutor, QueryResultRow } from './db.js';
import { EvidenceStoreError } from './errors.js';
import { assertNonEmptySessionId, toPersistenceValidationError } from './validation.js';

/**
 * The session-state-snapshots port (RFC §9.3): "periodic checkpoints of the
 * fusion engine's derived state ... for fast recovery." `save` never
 * overwrites an existing snapshot in place — each call records a new,
 * monotonically-numbered checkpoint — and `getLatest` is the read path the
 * recovery flow (M7) will use after a replica restart or session
 * re-routing.
 */
export interface SessionSnapshotRepository {
  save(snapshot: NewSessionStateSnapshot): Promise<SessionStateSnapshot>;
  getLatest(sessionId: string): Promise<SessionStateSnapshot | null>;
}

interface SessionStateSnapshotRow extends QueryResultRow {
  id: string;
  session_id: string;
  sequence: number;
  state: Record<string, unknown>;
  created_at: Date;
}

function rowToSnapshot(row: SessionStateSnapshotRow): SessionStateSnapshot {
  return SessionStateSnapshotSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    sequence: row.sequence,
    state: row.state,
    createdAt: row.created_at,
  });
}

/** Postgres unique_violation error code (session_id, sequence). */
const POSTGRES_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

/**
 * Postgres-backed `SessionSnapshotRepository`. Depends only on the narrow
 * `QueryExecutor` port, matching `PostgresEvidenceEventRepository`'s
 * dependency-inversion shape.
 */
export class PostgresSessionSnapshotRepository implements SessionSnapshotRepository {
  constructor(private readonly db: QueryExecutor) {}

  async save(snapshot: NewSessionStateSnapshot): Promise<SessionStateSnapshot> {
    let validated: NewSessionStateSnapshot;
    try {
      validated = NewSessionStateSnapshotSchema.parse(snapshot);
    } catch (error) {
      toPersistenceValidationError(error, 'Invalid session state snapshot');
    }

    const id = randomUUID();
    const createdAt = new Date();

    try {
      const result = await this.db.query<SessionStateSnapshotRow>(
        `INSERT INTO session_state_snapshots (id, session_id, sequence, state, created_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, session_id, sequence, state, created_at`,
        [id, validated.sessionId, validated.sequence, JSON.stringify(validated.state), createdAt],
      );

      const row = result.rows[0];
      if (row === undefined) {
        throw new EvidenceStoreError('Session state snapshot insert returned no row');
      }
      return rowToSnapshot(row);
    } catch (error) {
      if (error instanceof EvidenceStoreError) throw error;
      if (isUniqueViolation(error)) {
        throw new EvidenceStoreError(
          `Snapshot sequence ${validated.sequence} already exists for session ${validated.sessionId}`,
          error,
        );
      }
      throw new EvidenceStoreError('Failed to save session state snapshot', error);
    }
  }

  async getLatest(sessionId: string): Promise<SessionStateSnapshot | null> {
    assertNonEmptySessionId(sessionId);

    try {
      const result = await this.db.query<SessionStateSnapshotRow>(
        `SELECT id, session_id, sequence, state, created_at
         FROM session_state_snapshots
         WHERE session_id = $1
         ORDER BY sequence DESC
         LIMIT 1`,
        [sessionId],
      );
      const row = result.rows[0];
      return row === undefined ? null : rowToSnapshot(row);
    } catch (error) {
      throw new EvidenceStoreError('Failed to load latest session state snapshot', error);
    }
  }
}

/**
 * An in-memory `SessionSnapshotRepository`, sharing the Postgres
 * implementation's uniqueness and "latest by sequence" semantics. A test
 * double for future milestones (Fusion Engine snapshotting, M3; recovery,
 * M7), not a production storage option.
 */
export class InMemorySessionSnapshotRepository implements SessionSnapshotRepository {
  private readonly snapshotsBySession = new Map<string, SessionStateSnapshot[]>();

  async save(snapshot: NewSessionStateSnapshot): Promise<SessionStateSnapshot> {
    let validated: NewSessionStateSnapshot;
    try {
      validated = NewSessionStateSnapshotSchema.parse(snapshot);
    } catch (error) {
      toPersistenceValidationError(error, 'Invalid session state snapshot');
    }

    const existing = this.snapshotsBySession.get(validated.sessionId) ?? [];
    if (existing.some((entry) => entry.sequence === validated.sequence)) {
      throw new EvidenceStoreError(
        `Snapshot sequence ${validated.sequence} already exists for session ${validated.sessionId}`,
      );
    }

    const persisted: SessionStateSnapshot = {
      ...validated,
      id: randomUUID(),
      createdAt: new Date(),
    };
    this.snapshotsBySession.set(validated.sessionId, [...existing, persisted]);
    return persisted;
  }

  async getLatest(sessionId: string): Promise<SessionStateSnapshot | null> {
    assertNonEmptySessionId(sessionId);

    const existing = this.snapshotsBySession.get(sessionId);
    if (existing === undefined || existing.length === 0) {
      return null;
    }
    return existing.reduce((latest, candidate) =>
      candidate.sequence > latest.sequence ? candidate : latest,
    );
  }
}
