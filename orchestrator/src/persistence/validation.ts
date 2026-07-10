import { ZodError } from 'zod';

import { EvidencePersistenceValidationError } from './errors.js';

/**
 * Shared input-validation helpers used by every `EvidenceEventRepository`
 * and `SessionSnapshotRepository` implementation (Postgres-backed and
 * in-memory alike), so the two implementations of each port cannot drift on
 * what counts as a valid query.
 */

export const DEFAULT_LIST_LIMIT = 500;
export const MAX_LIST_LIMIT = 5_000;

export function zodIssueMessages(error: ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

/**
 * Re-throws a Zod validation failure as the persistence layer's own
 * `EvidencePersistenceValidationError`, so repository callers never need to
 * depend on `zod` themselves to distinguish "bad input" from "store
 * failure." Any other error is rethrown unchanged.
 */
export function toPersistenceValidationError(error: unknown, context: string): never {
  if (error instanceof ZodError) {
    throw new EvidencePersistenceValidationError(context, zodIssueMessages(error));
  }
  throw error;
}

export function assertNonEmptySessionId(sessionId: string): void {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new EvidencePersistenceValidationError('sessionId must not be empty', [
      'sessionId: must be a non-empty string',
    ]);
  }
}

/**
 * Validates and clamps a caller-supplied read limit. Absent a limit, a
 * conservative default applies rather than an unbounded read, so a bug
 * upstream cannot turn a single query into an unbounded full-table scan.
 */
export function clampListLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIST_LIMIT;
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new EvidencePersistenceValidationError('limit must be a positive integer', [
      `limit: received ${JSON.stringify(limit)}`,
    ]);
  }
  return Math.min(limit, MAX_LIST_LIMIT);
}
