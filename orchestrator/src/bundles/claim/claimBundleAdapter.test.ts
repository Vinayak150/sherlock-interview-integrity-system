import { describe, expect, it } from 'vitest';

import { InMemoryAtsClient } from './atsClient.js';
import type { IdentityClaimRecord } from './atsClient.js';
import { ClaimBundleAdapter } from './claimBundleAdapter.js';
import type { ObservedIdentityClaim } from './claimBundleAdapter.js';

function record(overrides: Partial<IdentityClaimRecord> = {}): IdentityClaimRecord {
  return {
    candidateId: 'candidate-1',
    applicationName: 'Jane Doe',
    applicationEmail: 'jane.doe@example.com',
    calendarInviteAttendeeEmail: 'jane.doe@example.com',
    hasReferencePhoto: true,
    hasPriorIdVerification: false,
    hasAccountHistory: true,
    ...overrides,
  };
}

function observed(overrides: Partial<ObservedIdentityClaim> = {}): ObservedIdentityClaim {
  return {
    candidateId: 'candidate-1',
    displayName: 'Jane Doe',
    joinEmail: 'jane.doe@example.com',
    calendarAttendeeEmail: 'jane.doe@example.com',
    ...overrides,
  };
}

function buildAdapter(seeded: IdentityClaimRecord): ClaimBundleAdapter {
  const client = new InMemoryAtsClient();
  client.seed(seeded);
  return new ClaimBundleAdapter(client);
}

const OCCURRED_AT = new Date('2026-07-10T12:00:00.000Z');

describe('ClaimBundleAdapter', () => {
  it('tags every event with the claim bundle and the requested occurredAt', async () => {
    const adapter = buildAdapter(record());
    const events = await adapter.buildEvidenceEvents('session-1', observed(), OCCURRED_AT);

    expect(events).toHaveLength(6);
    for (const event of events) {
      expect(event.bundle).toBe('claim');
      expect(event.sessionId).toBe('session-1');
      expect(event.occurredAt).toBe(OCCURRED_AT);
      expect(event.metadata).toBeNull();
    }
  });

  it('reports OK with matched=true when display name, email domain, and calendar invite all align', async () => {
    const adapter = buildAdapter(record());
    const events = await adapter.buildEvidenceEvents('session-1', observed(), OCCURRED_AT);

    const bySignal = new Map(events.map((event) => [event.signalName, event]));

    expect(bySignal.get('display_name_match')).toMatchObject({
      healthStatus: 'OK',
      value: { matched: true },
    });
    expect(bySignal.get('email_domain_match')).toMatchObject({
      healthStatus: 'OK',
      value: { matched: true },
    });
    expect(bySignal.get('calendar_invite_match')).toMatchObject({
      healthStatus: 'OK',
      value: { matched: true },
    });
  });

  it('matches display name case-insensitively', async () => {
    const adapter = buildAdapter(record({ applicationName: 'Jane Doe' }));
    const events = await adapter.buildEvidenceEvents(
      'session-1',
      observed({ displayName: 'JANE DOE' }),
      OCCURRED_AT,
    );

    const displayNameMatch = events.find((event) => event.signalName === 'display_name_match');
    expect(displayNameMatch?.value).toMatchObject({ matched: true });
  });

  it('matches email by domain only, ignoring the local part', async () => {
    const adapter = buildAdapter(record({ applicationEmail: 'jane.doe@corp.example.com' }));
    const events = await adapter.buildEvidenceEvents(
      'session-1',
      observed({ joinEmail: 'jane+interview@corp.example.com' }),
      OCCURRED_AT,
    );

    const emailMatch = events.find((event) => event.signalName === 'email_domain_match');
    expect(emailMatch?.value).toMatchObject({ matched: true });
  });

  it('reports matched=false, still OK, when the observed value contradicts the claim', async () => {
    const adapter = buildAdapter(record({ applicationName: 'Jane Doe' }));
    const events = await adapter.buildEvidenceEvents(
      'session-1',
      observed({ displayName: 'John Smith' }),
      OCCURRED_AT,
    );

    const displayNameMatch = events.find((event) => event.signalName === 'display_name_match');
    expect(displayNameMatch).toMatchObject({ healthStatus: 'OK', value: { matched: false } });
  });

  it('reports NO_SIGNAL_DETECTED, not a mismatch, when nothing was observed to compare', async () => {
    const adapter = buildAdapter(record());
    const events = await adapter.buildEvidenceEvents(
      'session-1',
      observed({ displayName: null }),
      OCCURRED_AT,
    );

    const displayNameMatch = events.find((event) => event.signalName === 'display_name_match');
    expect(displayNameMatch).toMatchObject({
      healthStatus: 'NO_SIGNAL_DETECTED',
      value: { matched: false, observedValue: null },
    });
  });

  it('reports NO_SIGNAL_DETECTED for calendar_invite_match when no invite is on file', async () => {
    const adapter = buildAdapter(record({ calendarInviteAttendeeEmail: null }));
    const events = await adapter.buildEvidenceEvents('session-1', observed(), OCCURRED_AT);

    const calendarMatch = events.find((event) => event.signalName === 'calendar_invite_match');
    expect(calendarMatch).toMatchObject({ healthStatus: 'NO_SIGNAL_DETECTED' });
  });

  it('reports presence signals directly from the ATS record, always OK', async () => {
    const adapter = buildAdapter(
      record({ hasReferencePhoto: false, hasPriorIdVerification: true, hasAccountHistory: false }),
    );
    const events = await adapter.buildEvidenceEvents('session-1', observed(), OCCURRED_AT);
    const bySignal = new Map(events.map((event) => [event.signalName, event]));

    expect(bySignal.get('reference_photo_available')).toMatchObject({
      healthStatus: 'OK',
      value: { available: false },
    });
    expect(bySignal.get('prior_id_verification_available')).toMatchObject({
      healthStatus: 'OK',
      value: { available: true },
    });
    expect(bySignal.get('account_history_available')).toMatchObject({
      healthStatus: 'OK',
      value: { available: false },
    });
  });

  it('reports every signal SERVICE_UNAVAILABLE when no ATS record exists for the candidate', async () => {
    const client = new InMemoryAtsClient();
    const adapter = new ClaimBundleAdapter(client);

    const events = await adapter.buildEvidenceEvents(
      'session-1',
      observed({ candidateId: 'unknown-candidate' }),
      OCCURRED_AT,
    );

    expect(events).toHaveLength(6);
    for (const event of events) {
      expect(event.healthStatus).toBe('SERVICE_UNAVAILABLE');
      expect(event.value).toMatchObject({ reason: expect.stringContaining('unknown-candidate') });
    }
  });
});
