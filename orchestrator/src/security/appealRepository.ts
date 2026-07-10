import { EvidencePersistenceValidationError } from '../persistence/index.js';

/**
 * The candidate appeal flow (RFC §15/Pilot-readiness bar: "consent +
 * appeal flow"; Plan M16). A candidate-facing record of a disputed
 * adverse decision (typically `DISQUALIFIED`) — deliberately a record +
 * status transition only. The actual adjudication of an appeal is a
 * human-review process this codebase does not automate (nothing about
 * "was this appeal justified" is a judgment call software should make
 * unilaterally); `resolve()` exists so a reviewer's decision has
 * somewhere durable to land, not so this module decides anything.
 *
 * Only an in-memory implementation is provided, matching every other
 * repository this milestone adds (`AccommodationDisclosureRepository`,
 * `AuditLogRepository`).
 */
export type AppealStatus = 'PENDING' | 'UPHELD' | 'OVERTURNED';

export interface Appeal {
  readonly id: string;
  readonly sessionId: string;
  readonly filedAt: Date;
  readonly candidateStatement: string;
  readonly status: AppealStatus;
  readonly resolvedAt: Date | null;
  readonly resolutionNote: string | null;
}

export interface NewAppeal {
  readonly sessionId: string;
  readonly candidateStatement: string;
}

export interface AppealRepository {
  file(appeal: NewAppeal): Promise<Appeal>;
  get(appealId: string): Promise<Appeal | null>;
  listBySession(sessionId: string): Promise<readonly Appeal[]>;
  resolve(
    appealId: string,
    status: 'UPHELD' | 'OVERTURNED',
    resolutionNote: string,
  ): Promise<Appeal>;
}

export class AppealNotFoundError extends Error {
  constructor(appealId: string) {
    super(`No appeal found with id ${appealId}`);
    this.name = 'AppealNotFoundError';
  }
}

function assertNonEmpty(name: string, value: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new EvidencePersistenceValidationError(`${name} must be a non-empty string`, [
      `${name}: must be a non-empty string`,
    ]);
  }
}

let nextAppealSequence = 0;

export class InMemoryAppealRepository implements AppealRepository {
  private readonly appealsById = new Map<string, Appeal>();

  async file(appeal: NewAppeal): Promise<Appeal> {
    assertNonEmpty('sessionId', appeal.sessionId);
    assertNonEmpty('candidateStatement', appeal.candidateStatement);

    nextAppealSequence += 1;
    const persisted: Appeal = {
      id: `appeal-${nextAppealSequence}`,
      sessionId: appeal.sessionId,
      filedAt: new Date(),
      candidateStatement: appeal.candidateStatement,
      status: 'PENDING',
      resolvedAt: null,
      resolutionNote: null,
    };
    this.appealsById.set(persisted.id, persisted);
    return persisted;
  }

  async get(appealId: string): Promise<Appeal | null> {
    return this.appealsById.get(appealId) ?? null;
  }

  async listBySession(sessionId: string): Promise<readonly Appeal[]> {
    return [...this.appealsById.values()].filter((appeal) => appeal.sessionId === sessionId);
  }

  async resolve(
    appealId: string,
    status: 'UPHELD' | 'OVERTURNED',
    resolutionNote: string,
  ): Promise<Appeal> {
    assertNonEmpty('resolutionNote', resolutionNote);
    const existing = this.appealsById.get(appealId);
    if (existing === undefined) {
      throw new AppealNotFoundError(appealId);
    }

    const resolved: Appeal = { ...existing, status, resolvedAt: new Date(), resolutionNote };
    this.appealsById.set(appealId, resolved);
    return resolved;
  }
}
