/**
 * The ATS-integration stub (Plan M2 deliverable: "ATS-integration stub").
 *
 * Represents the "ATS / Scheduling / Application Record" external
 * dependency from the RFC's context diagram (§9.1) and the Plan's list of
 * "External dependencies (integrated, not built)" (Plan §3) — the pre-call
 * source of the candidate's filed identity claim (Plan §2's
 * `IdentityClaimRecord`).
 *
 * `AtsClient` is the port the Claim Bundle Adapter depends on.
 * `InMemoryAtsClient` is the M2 stub implementation, explicitly seeded by
 * its caller. A real integration (a REST/webhook client against an actual
 * ATS/scheduling product) is out of scope for this milestone — the RFC
 * treats the ATS purely as a dependency the design must tolerate (§2
 * "Implicit Constraints"), never as something this codebase owns or builds.
 */

export interface IdentityClaimRecord {
  readonly candidateId: string;
  readonly applicationName: string;
  readonly applicationEmail: string;
  readonly calendarInviteAttendeeEmail: string | null;
  readonly hasReferencePhoto: boolean;
  readonly hasPriorIdVerification: boolean;
  readonly hasAccountHistory: boolean;
}

/**
 * Raised when no identity-claim record exists on file for a candidate.
 * Distinguished from a generic `AtsClientError` because the Claim Bundle
 * Adapter treats "no record on file" as a data-availability condition
 * (§13's signal-health contract: `SERVICE_UNAVAILABLE`, excluded from
 * evidence entirely), not as a match failure — conflating the two would be
 * exactly the "detector said no vs. detector didn't answer" bug class
 * ADR-11 exists to prevent, one layer up from where §13 states it.
 */
export class AtsRecordNotFoundError extends Error {
  constructor(candidateId: string) {
    super(`No identity-claim record on file for candidate "${candidateId}"`);
    this.name = 'AtsRecordNotFoundError';
  }
}

/** Any other ATS-integration failure (connection, timeout, malformed response, ...). */
export class AtsClientError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AtsClientError';
  }
}

export interface AtsClient {
  getIdentityClaimRecord(candidateId: string): Promise<IdentityClaimRecord>;
}

/**
 * An in-memory `AtsClient`, seeded explicitly by the caller (tests, or a
 * local/demo wiring). Never a production integration — see module doc
 * comment above.
 */
export class InMemoryAtsClient implements AtsClient {
  private readonly records = new Map<string, IdentityClaimRecord>();

  seed(record: IdentityClaimRecord): void {
    this.records.set(record.candidateId, record);
  }

  async getIdentityClaimRecord(candidateId: string): Promise<IdentityClaimRecord> {
    const record = this.records.get(candidateId);
    if (record === undefined) {
      throw new AtsRecordNotFoundError(candidateId);
    }
    return record;
  }
}
