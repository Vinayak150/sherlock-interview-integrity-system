import { describe, expect, it } from 'vitest';

import { EvidencePersistenceValidationError } from './errors.js';
import { InMemoryAccommodationDisclosureRepository } from './accommodationDisclosureRepository.js';

describe('InMemoryAccommodationDisclosureRepository', () => {
  it('returns null for a session with no disclosure on file', async () => {
    const repo = new InMemoryAccommodationDisclosureRepository();
    await expect(repo.get('session-1')).resolves.toBeNull();
  });

  it('records and retrieves a disclosure', async () => {
    const repo = new InMemoryAccommodationDisclosureRepository();
    await repo.record({ sessionId: 'session-1', reason: 'interpreter present' });

    const disclosure = await repo.get('session-1');
    expect(disclosure).toMatchObject({ sessionId: 'session-1', reason: 'interpreter present' });
    expect(disclosure?.disclosedAt).toBeInstanceOf(Date);
  });

  it('overwrites a prior disclosure for the same session', async () => {
    const repo = new InMemoryAccommodationDisclosureRepository();
    await repo.record({ sessionId: 'session-1', reason: 'interpreter present' });
    await repo.record({ sessionId: 'session-1', reason: 'accessibility support' });

    const disclosure = await repo.get('session-1');
    expect(disclosure?.reason).toBe('accessibility support');
  });

  it('keeps disclosures isolated per session', async () => {
    const repo = new InMemoryAccommodationDisclosureRepository();
    await repo.record({ sessionId: 'session-a', reason: 'reason A' });

    await expect(repo.get('session-b')).resolves.toBeNull();
  });

  it('rejects an empty sessionId', async () => {
    const repo = new InMemoryAccommodationDisclosureRepository();
    await expect(repo.record({ sessionId: '', reason: 'x' })).rejects.toBeInstanceOf(
      EvidencePersistenceValidationError,
    );
  });

  it('rejects an empty reason', async () => {
    const repo = new InMemoryAccommodationDisclosureRepository();
    await expect(repo.record({ sessionId: 'session-1', reason: '' })).rejects.toBeInstanceOf(
      EvidencePersistenceValidationError,
    );
  });
});
