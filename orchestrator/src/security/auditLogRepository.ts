import { EvidencePersistenceValidationError } from '../persistence/index.js';

/**
 * Audit-log coverage for every biometric-evidence view (RFC §15/Pilot-
 * readiness bar; Plan M16: "audit-log coverage for every biometric-
 * evidence view"). Records *who* viewed *which* session's evidence, and
 * when — access-control *enforcement* is explicitly out of scope (this
 * codebase has no user-identity/authentication system at all; `viewedBy`
 * is a caller-supplied label, not a verified principal) and is called
 * out here as a limitation rather than silently assumed away. The audit
 * *log* itself, wired into the API layer's read paths
 * (`SessionOrchestrationService.getSessionStatus`), is real.
 *
 * Only an in-memory implementation is provided, matching
 * `AccommodationDisclosureRepository`'s own stated scope limitation.
 */
export interface AuditLogEntry {
  readonly sessionId: string;
  readonly viewedBy: string;
  readonly viewedAt: Date;
  readonly reason: string;
}

export interface NewAuditLogEntry {
  readonly sessionId: string;
  readonly viewedBy: string;
  readonly reason: string;
}

export interface AuditLogRepository {
  record(entry: NewAuditLogEntry): Promise<AuditLogEntry>;
  listBySession(sessionId: string): Promise<readonly AuditLogEntry[]>;
}

function assertNonEmpty(name: string, value: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new EvidencePersistenceValidationError(`${name} must be a non-empty string`, [
      `${name}: must be a non-empty string`,
    ]);
  }
}

export class InMemoryAuditLogRepository implements AuditLogRepository {
  private readonly entriesBySession = new Map<string, AuditLogEntry[]>();

  async record(entry: NewAuditLogEntry): Promise<AuditLogEntry> {
    assertNonEmpty('sessionId', entry.sessionId);
    assertNonEmpty('viewedBy', entry.viewedBy);
    assertNonEmpty('reason', entry.reason);

    const persisted: AuditLogEntry = { ...entry, viewedAt: new Date() };
    const existing = this.entriesBySession.get(entry.sessionId) ?? [];
    existing.push(persisted);
    this.entriesBySession.set(entry.sessionId, existing);
    return persisted;
  }

  async listBySession(sessionId: string): Promise<readonly AuditLogEntry[]> {
    assertNonEmpty('sessionId', sessionId);
    return [...(this.entriesBySession.get(sessionId) ?? [])];
  }
}
