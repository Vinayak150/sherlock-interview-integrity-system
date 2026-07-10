import type { Migration } from '../migrationRunner.js';
import { createEvidenceEventsTable } from './0001_create_evidence_events.js';
import { createSessionStateSnapshotsTable } from './0002_create_session_state_snapshots.js';

/**
 * The Evidence Store's full migration history, in application order. New
 * migrations are appended here — never inserted earlier or edited in place
 * once merged, since `runMigrations` (M1) treats id order as apply order
 * and a previously-applied migration's `sql` is never re-run.
 */
export const MIGRATIONS: readonly Migration[] = [
  createEvidenceEventsTable,
  createSessionStateSnapshotsTable,
];
