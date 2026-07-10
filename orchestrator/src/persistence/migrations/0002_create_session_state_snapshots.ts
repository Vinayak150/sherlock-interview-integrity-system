import type { Migration } from '../migrationRunner.js';

/**
 * The session-state-snapshots table (RFC §9.3, ADR-7): "periodic
 * checkpoints of the fusion engine's derived state ... for fast recovery."
 * `state` is an opaque JSONB payload — the Fusion Engine (M3) owns its
 * internal representation; this table only owns the durable envelope
 * around it (`session_id`, a monotonic `sequence`, and a timestamp).
 *
 * The `UNIQUE (session_id, sequence)` constraint makes "the latest
 * snapshot for this session" ( `ORDER BY sequence DESC LIMIT 1`, see
 * `SessionSnapshotRepository.getLatest`) an unambiguous query, and makes a
 * duplicate-sequence write — a bug indicator, not a legitimate retry — fail
 * loudly at the database rather than silently overwrite history.
 */
export const createSessionStateSnapshotsTable: Migration = {
  id: '0002_create_session_state_snapshots',
  sql: `
    CREATE TABLE IF NOT EXISTS session_state_snapshots (
      id UUID PRIMARY KEY,
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      state JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      UNIQUE (session_id, sequence)
    );

    CREATE INDEX IF NOT EXISTS session_state_snapshots_session_sequence_idx
      ON session_state_snapshots (session_id, sequence DESC);
  `,
};
