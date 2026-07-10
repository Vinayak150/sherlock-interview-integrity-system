import type { ClaimMatchValue, ClaimPresenceValue, NewEvidenceEvent } from '@sherlock/contracts';

import type { BundleAdapter } from '../types.js';
import { makeEvidenceEvent } from '../types.js';
import type { AtsClient, IdentityClaimRecord } from './atsClient.js';
import { AtsRecordNotFoundError } from './atsClient.js';

/**
 * What was actually observed at call time, to compare against the filed
 * `IdentityClaimRecord` (RFC §4-A). `null` on a field means "nothing was
 * observed for this" (e.g. no calendar invite attached to this session) —
 * never coerced into a mismatch.
 */
export interface ObservedIdentityClaim {
  readonly candidateId: string;
  readonly displayName: string | null;
  readonly joinEmail: string | null;
  readonly calendarAttendeeEmail: string | null;
}

const CLAIM_SERVICE_UNAVAILABLE_SIGNAL_NAMES = [
  'display_name_match',
  'email_domain_match',
  'calendar_invite_match',
  'reference_photo_available',
  'prior_id_verification_available',
  'account_history_available',
] as const;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return normalize(at === -1 ? email : email.slice(at + 1));
}

function buildMatchValue(
  observed: string | null,
  claimed: string | null,
  matches: (a: string, b: string) => boolean,
): ClaimMatchValue {
  return {
    matched: observed !== null && claimed !== null && matches(observed, claimed),
    observedValue: observed,
    claimedValue: claimed,
  };
}

/**
 * Normalizes pre-call identity-claim signals (RFC §4-A) into
 * signal-health-tagged `EvidenceEvent`s. All six §4-A signals this
 * milestone covers are always emitted, whether or not they match — a
 * non-match is evidence too (§5) — and "nothing on file to compare"
 * (e.g. no calendar invite) is reported as `NO_SIGNAL_DETECTED`, never
 * silently omitted or folded into a negative match. If the ATS lookup
 * itself fails (no record on file for this candidate), every signal is
 * reported `SERVICE_UNAVAILABLE` instead — §13's contract, honored here
 * even though the Fusion Engine that consumes it doesn't exist until M3.
 */
export class ClaimBundleAdapter implements BundleAdapter<ObservedIdentityClaim> {
  readonly bundle = 'claim' as const;

  constructor(private readonly atsClient: AtsClient) {}

  async buildEvidenceEvents(
    sessionId: string,
    observed: ObservedIdentityClaim,
    occurredAt: Date = new Date(),
  ): Promise<readonly NewEvidenceEvent[]> {
    let record: IdentityClaimRecord;
    try {
      record = await this.atsClient.getIdentityClaimRecord(observed.candidateId);
    } catch (error) {
      if (error instanceof AtsRecordNotFoundError) {
        return this.buildServiceUnavailableEvents(sessionId, occurredAt, error.message);
      }
      throw error;
    }

    return [
      this.buildMatchEvent(
        sessionId,
        'display_name_match',
        buildMatchValue(
          observed.displayName,
          record.applicationName,
          (a, b) => normalize(a) === normalize(b),
        ),
        occurredAt,
      ),
      this.buildMatchEvent(
        sessionId,
        'email_domain_match',
        buildMatchValue(
          observed.joinEmail,
          record.applicationEmail,
          (a, b) => emailDomain(a) === emailDomain(b),
        ),
        occurredAt,
      ),
      this.buildMatchEvent(
        sessionId,
        'calendar_invite_match',
        buildMatchValue(
          observed.calendarAttendeeEmail,
          record.calendarInviteAttendeeEmail,
          (a, b) => normalize(a) === normalize(b),
        ),
        occurredAt,
      ),
      this.buildPresenceEvent(
        sessionId,
        'reference_photo_available',
        record.hasReferencePhoto,
        occurredAt,
      ),
      this.buildPresenceEvent(
        sessionId,
        'prior_id_verification_available',
        record.hasPriorIdVerification,
        occurredAt,
      ),
      this.buildPresenceEvent(
        sessionId,
        'account_history_available',
        record.hasAccountHistory,
        occurredAt,
      ),
    ];
  }

  private buildMatchEvent(
    sessionId: string,
    signalName: 'display_name_match' | 'email_domain_match' | 'calendar_invite_match',
    value: ClaimMatchValue,
    occurredAt: Date,
  ): NewEvidenceEvent {
    const healthStatus =
      value.observedValue === null || value.claimedValue === null ? 'NO_SIGNAL_DETECTED' : 'OK';
    return makeEvidenceEvent({
      sessionId,
      bundle: this.bundle,
      signalName,
      healthStatus,
      value,
      occurredAt,
    });
  }

  private buildPresenceEvent(
    sessionId: string,
    signalName:
      'reference_photo_available' | 'prior_id_verification_available' | 'account_history_available',
    available: boolean,
    occurredAt: Date,
  ): NewEvidenceEvent {
    const value: ClaimPresenceValue = { available, reference: null };
    return makeEvidenceEvent({
      sessionId,
      bundle: this.bundle,
      signalName,
      healthStatus: 'OK',
      value,
      occurredAt,
    });
  }

  private buildServiceUnavailableEvents(
    sessionId: string,
    occurredAt: Date,
    reason: string,
  ): NewEvidenceEvent[] {
    return CLAIM_SERVICE_UNAVAILABLE_SIGNAL_NAMES.map((signalName) =>
      makeEvidenceEvent({
        sessionId,
        bundle: this.bundle,
        signalName,
        healthStatus: 'SERVICE_UNAVAILABLE',
        value: { reason },
        occurredAt,
      }),
    );
  }
}
