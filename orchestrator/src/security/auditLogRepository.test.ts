import { describe, expect, it } from 'vitest';

import { EvidencePersistenceValidationError } from '../persistence/index.js';
import { InMemoryAuditLogRepository } from './auditLogRepository.js';

describe('InMemoryAuditLogRepository', () => {
  it('returns an empty list for a session with no recorded views', async () => {
    const repo = new InMemoryAuditLogRepository();
    await expect(repo.listBySession('session-1')).resolves.toEqual([]);
  });

  it('records and lists a view', async () => {
    const repo = new InMemoryAuditLogRepository();
    await repo.record({
      sessionId: 'session-1',
      viewedBy: 'reviewer-alice',
      reason: 'status check',
    });

    const entries = await repo.listBySession('session-1');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      sessionId: 'session-1',
      viewedBy: 'reviewer-alice',
      reason: 'status check',
    });
    expect(entries[0]?.viewedAt).toBeInstanceOf(Date);
  });

  it('accumulates multiple views for the same session in order', async () => {
    const repo = new InMemoryAuditLogRepository();
    await repo.record({
      sessionId: 'session-1',
      viewedBy: 'reviewer-alice',
      reason: 'first check',
    });
    await repo.record({ sessionId: 'session-1', viewedBy: 'reviewer-bob', reason: 'second check' });

    const entries = await repo.listBySession('session-1');
    expect(entries.map((e) => e.viewedBy)).toEqual(['reviewer-alice', 'reviewer-bob']);
  });

  it('keeps audit logs isolated per session', async () => {
    const repo = new InMemoryAuditLogRepository();
    await repo.record({ sessionId: 'session-a', viewedBy: 'reviewer-alice', reason: 'x' });

    await expect(repo.listBySession('session-b')).resolves.toEqual([]);
  });

  it('rejects an empty viewedBy', async () => {
    const repo = new InMemoryAuditLogRepository();
    await expect(
      repo.record({ sessionId: 'session-1', viewedBy: '', reason: 'x' }),
    ).rejects.toBeInstanceOf(EvidencePersistenceValidationError);
  });
});
