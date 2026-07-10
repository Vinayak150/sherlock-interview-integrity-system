import type { NewEvidenceEvent } from '@sherlock/contracts';
import { describe, expect, it } from 'vitest';

import { InMemoryEvidenceEventRepository } from '../persistence/index.js';
import { EncryptingEvidenceEventRepository } from './encryptingEvidenceEventRepository.js';

const OCCURRED_AT = new Date('2026-07-10T12:00:00.000Z');

function visualEvent(overrides: Partial<NewEvidenceEvent> = {}): NewEvidenceEvent {
  return {
    sessionId: 'session-1',
    bundle: 'visual',
    signalName: 'face_embedding_self_consistency',
    healthStatus: 'OK',
    value: { similarity: 0.92, isFirstObservation: false },
    occurredAt: OCCURRED_AT,
    metadata: null,
    ...overrides,
  };
}

function claimEvent(overrides: Partial<NewEvidenceEvent> = {}): NewEvidenceEvent {
  return {
    sessionId: 'session-1',
    bundle: 'claim',
    signalName: 'email_domain_match',
    healthStatus: 'OK',
    value: { matched: true },
    occurredAt: OCCURRED_AT,
    metadata: null,
    ...overrides,
  };
}

describe('EncryptingEvidenceEventRepository', () => {
  it('returns the plaintext value to the immediate append() caller', async () => {
    const repo = new EncryptingEvidenceEventRepository(
      new InMemoryEvidenceEventRepository(),
      'test-key',
    );
    const persisted = await repo.append(visualEvent());

    expect(persisted.value).toEqual({ similarity: 0.92, isFirstObservation: false });
  });

  it('stores an encrypted envelope for a visual/audio bundle, not the plaintext, in the underlying repository', async () => {
    const inner = new InMemoryEvidenceEventRepository();
    const repo = new EncryptingEvidenceEventRepository(inner, 'test-key');
    await repo.append(visualEvent());

    const rawFromInner = await inner.listBySession('session-1');
    expect(rawFromInner[0]?.value).toMatchObject({ __sherlockEncrypted: true });
    expect(JSON.stringify(rawFromInner[0]?.value)).not.toContain('0.92');
  });

  it('transparently decrypts on listBySession, returning the original plaintext value', async () => {
    const repo = new EncryptingEvidenceEventRepository(
      new InMemoryEvidenceEventRepository(),
      'test-key',
    );
    await repo.append(visualEvent());

    const events = await repo.listBySession('session-1');
    expect(events[0]?.value).toEqual({ similarity: 0.92, isFirstObservation: false });
  });

  it('leaves non-biometric bundles (claim/metadata/...) entirely unencrypted', async () => {
    const inner = new InMemoryEvidenceEventRepository();
    const repo = new EncryptingEvidenceEventRepository(inner, 'test-key');
    await repo.append(claimEvent());

    const rawFromInner = await inner.listBySession('session-1');
    expect(rawFromInner[0]?.value).toEqual({ matched: true });
  });

  it('leaves a null value (e.g. a declined-consent event) untouched', async () => {
    const repo = new EncryptingEvidenceEventRepository(
      new InMemoryEvidenceEventRepository(),
      'test-key',
    );
    await repo.append(visualEvent({ value: null, healthStatus: 'NO_SIGNAL_DETECTED' }));

    const events = await repo.listBySession('session-1');
    expect(events[0]?.value).toBeNull();
  });

  it('round-trips multiple visual/audio events for the same session correctly', async () => {
    const repo = new EncryptingEvidenceEventRepository(
      new InMemoryEvidenceEventRepository(),
      'test-key',
    );
    await repo.append(
      visualEvent({
        signalName: 'face_embedding_self_consistency',
        value: { similarity: 0.5, isFirstObservation: false },
      }),
    );
    await repo.append(
      visualEvent({
        bundle: 'audio',
        signalName: 'voice_embedding_self_consistency',
        value: { similarity: 0.7, isFirstObservation: false },
      }),
    );

    const events = await repo.listBySession('session-1');
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.bundle === 'visual')?.value).toEqual({
      similarity: 0.5,
      isFirstObservation: false,
    });
    expect(events.find((e) => e.bundle === 'audio')?.value).toEqual({
      similarity: 0.7,
      isFirstObservation: false,
    });
  });

  it('preserves every other EvidenceEvent field unchanged through the decrypt path', async () => {
    const repo = new EncryptingEvidenceEventRepository(
      new InMemoryEvidenceEventRepository(),
      'test-key',
    );
    const persisted = await repo.append(visualEvent());

    const events = await repo.listBySession('session-1');
    const roundTripped = events[0];
    expect(roundTripped?.id).toBe(persisted.id);
    expect(roundTripped?.sessionId).toBe('session-1');
    expect(roundTripped?.bundle).toBe('visual');
    expect(roundTripped?.healthStatus).toBe('OK');
  });
});
