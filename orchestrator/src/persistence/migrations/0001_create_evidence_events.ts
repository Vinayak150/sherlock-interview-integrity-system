import type { Migration } from '../migrationRunner.js';

/**
 * The append-only evidence-events table (RFC §9.3, ADR-7): "the audit
 * trail, the training-data source, and the thing that gives most of
 * event-sourcing's practical benefit without adopting it as the
 * state-management pattern." Rows are never updated or deleted by
 * application code — see `EvidenceEventRepository`, which exposes `append`
 * only, no `update`/`delete`.
 *
 * `id` is generated application-side (`crypto.randomUUID()`) rather than by
 * a database-side default, so the repository never depends on a Postgres
 * extension (e.g. `pgcrypto`) being installed.
 *
 * `value` and `metadata` are `JSONB`: their concrete shape is owned by
 * whichever Bundle Adapter produced the event (M2+), not by this table.
 *
 * The `(session_id, occurred_at)` index supports the two read patterns the
 * Fusion Engine and audit/evaluation tooling need: "this session's evidence,
 * in time order."
 */
export const createEvidenceEventsTable: Migration = {
  id: '0001_create_evidence_events',
  sql: `
    CREATE TABLE IF NOT EXISTS evidence_events (
      id UUID PRIMARY KEY,
      session_id TEXT NOT NULL,
      bundle TEXT NOT NULL,
      signal_name TEXT NOT NULL,
      health_status TEXT NOT NULL,
      value JSONB,
      metadata JSONB,
      occurred_at TIMESTAMPTZ NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX IF NOT EXISTS evidence_events_session_occurred_idx
      ON evidence_events (session_id, occurred_at);
  `,
};
