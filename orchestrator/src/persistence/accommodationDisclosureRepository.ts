import { EvidencePersistenceValidationError } from './errors.js';

/**
 * `AccommodationDisclosure` (Plan §2 domain model; RFC §11/ADR-13): "a
 * pre-interview, candidate-facing disclosure record that removes a
 * legitimate multi-person/no-camera setup from the suspicion pool
 * entirely." Plan M13 lists this flow as one of that milestone's
 * deliverables.
 *
 * Scope note: this milestone implements the disclosure *record* itself —
 * storage, and surfacing it on `SessionStatus` (Plan M13's dashboard
 * needs a source of truth for whether a session was disclosed) — not a
 * deeper Fusion/Decision Engine integration that actively suppresses
 * specific signals for a disclosed session. That deeper integration would
 * touch already-completed modules non-trivially (which multi-person/no-
 * camera signals to suppress, and how, is itself a judgment call the RFC
 * does not fully specify) and is called out explicitly as a limitation
 * rather than guessed at.
 *
 * Only an in-memory implementation is provided — see this module's own
 * limitation note in the final report; a Postgres-backed implementation
 * would follow the exact same port + `Postgres*`/`InMemory*` pattern
 * every other repository in this codebase already uses.
 */
export interface AccommodationDisclosure {
  readonly sessionId: string;
  readonly disclosedAt: Date;
  readonly reason: string;
}

export interface NewAccommodationDisclosure {
  readonly sessionId: string;
  readonly reason: string;
}

export interface AccommodationDisclosureRepository {
  record(disclosure: NewAccommodationDisclosure): Promise<AccommodationDisclosure>;
  get(sessionId: string): Promise<AccommodationDisclosure | null>;
}

function assertNonEmpty(name: string, value: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new EvidencePersistenceValidationError(`${name} must be a non-empty string`, [
      `${name}: must be a non-empty string`,
    ]);
  }
}

export class InMemoryAccommodationDisclosureRepository implements AccommodationDisclosureRepository {
  private readonly disclosuresBySession = new Map<string, AccommodationDisclosure>();

  async record(disclosure: NewAccommodationDisclosure): Promise<AccommodationDisclosure> {
    assertNonEmpty('sessionId', disclosure.sessionId);
    assertNonEmpty('reason', disclosure.reason);

    const persisted: AccommodationDisclosure = {
      sessionId: disclosure.sessionId,
      reason: disclosure.reason,
      disclosedAt: new Date(),
    };
    this.disclosuresBySession.set(disclosure.sessionId, persisted);
    return persisted;
  }

  async get(sessionId: string): Promise<AccommodationDisclosure | null> {
    assertNonEmpty('sessionId', sessionId);
    return this.disclosuresBySession.get(sessionId) ?? null;
  }
}
