import { randomUUID } from 'node:crypto';

import { EvidenceEventSchema, NewEvidenceEventSchema } from '@sherlock/contracts';
import type { EvidenceEvent, NewEvidenceEvent } from '@sherlock/contracts';

import type { QueryExecutor, QueryResultRow } from './db.js';
import { EvidenceStoreError } from './errors.js';
import { EvidencePersistenceValidationError } from './errors.js';
import {
  MAX_LIST_LIMIT,
  assertNonEmptySessionId,
  clampListLimit,
  toPersistenceValidationError,
} from './validation.js';

/**
 * The append-only Evidence Store port (RFC §9.3): every evidence event is
 * durably written before it may affect the live score (Plan §9,
 * "Ledger-authoritative-before-score ordering"). This interface
 * deliberately exposes only `append` and read methods — no `update`, no
 * `delete` — so the "immutable once written" invariant (Plan §2 domain
 * model) cannot be violated through this port, by construction.
 */
export interface EvidenceEventRepository {
  append(event: NewEvidenceEvent): Promise<EvidenceEvent>;
  listBySession(
    sessionId: string,
    options?: { readonly limit?: number; readonly offset?: number },
  ): Promise<readonly EvidenceEvent[]>;
  /** Loads every persisted event for a session by paging — fusion must never silently truncate mid-session history (RFC §10). */
  listAllBySession(sessionId: string): Promise<readonly EvidenceEvent[]>;
}

interface EvidenceEventRow extends QueryResultRow {
  id: string;
  session_id: string;
  bundle: string;
  signal_name: string;
  health_status: string;
  value: unknown;
  metadata: Record<string, unknown> | null;
  occurred_at: Date;
  recorded_at: Date;
}

function rowToEvidenceEvent(row: EvidenceEventRow): EvidenceEvent {
  return EvidenceEventSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    bundle: row.bundle,
    signalName: row.signal_name,
    healthStatus: row.health_status,
    value: row.value,
    metadata: row.metadata,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
  });
}

/**
 * Postgres-backed `EvidenceEventRepository`. Depends only on the narrow
 * `QueryExecutor` port — the fact that RFC §9.3 chose "one relational
 * database" is an implementation detail hidden behind it — so this class is
 * trivially testable with a fake executor and swappable if the storage
 * technology ever changes without touching any caller.
 */
export class PostgresEvidenceEventRepository implements EvidenceEventRepository {
  constructor(private readonly db: QueryExecutor) {}

  async append(event: NewEvidenceEvent): Promise<EvidenceEvent> {
    let validated: NewEvidenceEvent;
    try {
      validated = NewEvidenceEventSchema.parse(event);
    } catch (error) {
      toPersistenceValidationError(error, 'Invalid evidence event');
    }

    const id = randomUUID();
    const recordedAt = new Date();

    try {
      const result = await this.db.query<EvidenceEventRow>(
        `INSERT INTO evidence_events
           (id, session_id, bundle, signal_name, health_status, value, metadata, occurred_at, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, session_id, bundle, signal_name, health_status, value, metadata, occurred_at, recorded_at`,
        [
          id,
          validated.sessionId,
          validated.bundle,
          validated.signalName,
          validated.healthStatus,
          validated.value === undefined ? null : JSON.stringify(validated.value),
          validated.metadata === null ? null : JSON.stringify(validated.metadata),
          validated.occurredAt,
          recordedAt,
        ],
      );

      const row = result.rows[0];
      if (row === undefined) {
        throw new EvidenceStoreError('Evidence event insert returned no row');
      }
      return rowToEvidenceEvent(row);
    } catch (error) {
      if (error instanceof EvidenceStoreError) throw error;
      throw new EvidenceStoreError('Failed to append evidence event', error);
    }
  }

  async listBySession(
    sessionId: string,
    options: { readonly limit?: number; readonly offset?: number } = {},
  ): Promise<readonly EvidenceEvent[]> {
    assertNonEmptySessionId(sessionId);
    const limit = clampListLimit(options.limit);
    const offset = options.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0) {
      throw new EvidencePersistenceValidationError('offset must be a non-negative integer', [
        `offset: received ${JSON.stringify(offset)}`,
      ]);
    }

    try {
      const result = await this.db.query<EvidenceEventRow>(
        `SELECT id, session_id, bundle, signal_name, health_status, value, metadata, occurred_at, recorded_at
         FROM evidence_events
         WHERE session_id = $1
         ORDER BY occurred_at ASC, id ASC
         LIMIT $2 OFFSET $3`,
        [sessionId, limit, offset],
      );
      return result.rows.map(rowToEvidenceEvent);
    } catch (error) {
      throw new EvidenceStoreError('Failed to list evidence events for session', error);
    }
  }

  async listAllBySession(sessionId: string): Promise<readonly EvidenceEvent[]> {
    const all: EvidenceEvent[] = [];
    let offset = 0;
    while (true) {
      const page = await this.listBySession(sessionId, { limit: MAX_LIST_LIMIT, offset });
      all.push(...page);
      if (page.length < MAX_LIST_LIMIT) {
        return all;
      }
      offset += page.length;
    }
  }
}

/**
 * An in-memory `EvidenceEventRepository`, sharing the exact validation and
 * ordering semantics of the Postgres-backed implementation. Not a
 * production storage option — the Evidence Store is durable by
 * architectural requirement (RFC §9.3) — but a first-class test double for
 * every future module (Fusion Engine, M3+) that depends on this port
 * without needing a real database in its own unit tests.
 */
export class InMemoryEvidenceEventRepository implements EvidenceEventRepository {
  private readonly events: EvidenceEvent[] = [];

  async append(event: NewEvidenceEvent): Promise<EvidenceEvent> {
    let validated: NewEvidenceEvent;
    try {
      validated = NewEvidenceEventSchema.parse(event);
    } catch (error) {
      toPersistenceValidationError(error, 'Invalid evidence event');
    }

    const persisted: EvidenceEvent = {
      ...validated,
      id: randomUUID(),
      recordedAt: new Date(),
    };
    this.events.push(persisted);
    return persisted;
  }

  async listBySession(
    sessionId: string,
    options: { readonly limit?: number; readonly offset?: number } = {},
  ): Promise<readonly EvidenceEvent[]> {
    assertNonEmptySessionId(sessionId);
    const limit = clampListLimit(options.limit);
    const offset = options.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0) {
      throw new EvidencePersistenceValidationError('offset must be a non-negative integer', [
        `offset: received ${JSON.stringify(offset)}`,
      ]);
    }

    return this.events
      .filter((event) => event.sessionId === sessionId)
      .sort(
        (a, b) =>
          a.occurredAt.getTime() - b.occurredAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .slice(offset, offset + limit);
  }

  async listAllBySession(sessionId: string): Promise<readonly EvidenceEvent[]> {
    const all: EvidenceEvent[] = [];
    let offset = 0;
    while (true) {
      const page = await this.listBySession(sessionId, { limit: MAX_LIST_LIMIT, offset });
      all.push(...page);
      if (page.length < MAX_LIST_LIMIT) {
        return all;
      }
      offset += page.length;
    }
  }
}
