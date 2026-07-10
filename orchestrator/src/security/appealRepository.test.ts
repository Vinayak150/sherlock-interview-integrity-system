import { describe, expect, it } from 'vitest';

import { EvidencePersistenceValidationError } from '../persistence/index.js';
import { AppealNotFoundError, InMemoryAppealRepository } from './appealRepository.js';

describe('InMemoryAppealRepository', () => {
  it('files a new appeal in PENDING status', async () => {
    const repo = new InMemoryAppealRepository();
    const appeal = await repo.file({
      sessionId: 'session-1',
      candidateStatement: 'That was really me.',
    });

    expect(appeal.status).toBe('PENDING');
    expect(appeal.resolvedAt).toBeNull();
    expect(appeal.sessionId).toBe('session-1');
  });

  it('retrieves a filed appeal by id', async () => {
    const repo = new InMemoryAppealRepository();
    const filed = await repo.file({ sessionId: 'session-1', candidateStatement: 'statement' });

    const fetched = await repo.get(filed.id);
    expect(fetched).toEqual(filed);
  });

  it('returns null for an unknown appeal id', async () => {
    const repo = new InMemoryAppealRepository();
    await expect(repo.get('does-not-exist')).resolves.toBeNull();
  });

  it('lists every appeal filed for a session', async () => {
    const repo = new InMemoryAppealRepository();
    await repo.file({ sessionId: 'session-1', candidateStatement: 'first' });
    await repo.file({ sessionId: 'session-1', candidateStatement: 'second' });
    await repo.file({ sessionId: 'session-2', candidateStatement: 'unrelated' });

    const appeals = await repo.listBySession('session-1');
    expect(appeals).toHaveLength(2);
  });

  it('resolve() transitions status and records a resolution note and timestamp', async () => {
    const repo = new InMemoryAppealRepository();
    const filed = await repo.file({ sessionId: 'session-1', candidateStatement: 'statement' });

    const resolved = await repo.resolve(
      filed.id,
      'OVERTURNED',
      'Reviewed footage, confirmed identity.',
    );

    expect(resolved.status).toBe('OVERTURNED');
    expect(resolved.resolutionNote).toBe('Reviewed footage, confirmed identity.');
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
  });

  it('throws AppealNotFoundError when resolving an unknown appeal', async () => {
    const repo = new InMemoryAppealRepository();
    await expect(repo.resolve('does-not-exist', 'UPHELD', 'note')).rejects.toBeInstanceOf(
      AppealNotFoundError,
    );
  });

  it('rejects an empty candidateStatement', async () => {
    const repo = new InMemoryAppealRepository();
    await expect(
      repo.file({ sessionId: 'session-1', candidateStatement: '' }),
    ).rejects.toBeInstanceOf(EvidencePersistenceValidationError);
  });
});
