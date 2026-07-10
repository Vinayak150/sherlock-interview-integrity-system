import { describe, expect, it } from 'vitest';

import { AtsRecordNotFoundError, InMemoryAtsClient } from './atsClient.js';
import type { IdentityClaimRecord } from './atsClient.js';

function record(overrides: Partial<IdentityClaimRecord> = {}): IdentityClaimRecord {
  return {
    candidateId: 'candidate-1',
    applicationName: 'Jane Doe',
    applicationEmail: 'jane.doe@example.com',
    calendarInviteAttendeeEmail: 'jane.doe@example.com',
    hasReferencePhoto: true,
    hasPriorIdVerification: false,
    hasAccountHistory: false,
    ...overrides,
  };
}

describe('InMemoryAtsClient', () => {
  it('returns a seeded record by candidateId', async () => {
    const client = new InMemoryAtsClient();
    client.seed(record());

    await expect(client.getIdentityClaimRecord('candidate-1')).resolves.toMatchObject({
      applicationName: 'Jane Doe',
    });
  });

  it('throws AtsRecordNotFoundError for an unseeded candidateId', async () => {
    const client = new InMemoryAtsClient();

    await expect(client.getIdentityClaimRecord('unknown-candidate')).rejects.toBeInstanceOf(
      AtsRecordNotFoundError,
    );
  });

  it('keeps records isolated per candidateId', async () => {
    const client = new InMemoryAtsClient();
    client.seed(record({ candidateId: 'candidate-1', applicationName: 'Jane Doe' }));
    client.seed(record({ candidateId: 'candidate-2', applicationName: 'John Smith' }));

    await expect(client.getIdentityClaimRecord('candidate-2')).resolves.toMatchObject({
      applicationName: 'John Smith',
    });
  });

  it('overwrites a prior seed for the same candidateId', async () => {
    const client = new InMemoryAtsClient();
    client.seed(record({ applicationName: 'Jane Doe' }));
    client.seed(record({ applicationName: 'Jane D. Doe' }));

    await expect(client.getIdentityClaimRecord('candidate-1')).resolves.toMatchObject({
      applicationName: 'Jane D. Doe',
    });
  });
});
