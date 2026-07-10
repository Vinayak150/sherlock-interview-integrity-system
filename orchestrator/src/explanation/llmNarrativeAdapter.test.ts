import { describe, expect, it, vi } from 'vitest';

import { LlmNarrativeAdapter } from './llmNarrativeAdapter.js';
import type { LlmProvider } from './llmProvider.js';
import { StubLlmProvider } from './llmProvider.js';
import type { EvidenceReport } from './types.js';

function report(overrides: Partial<EvidenceReport> = {}): EvidenceReport {
  return {
    sessionId: 'session-1',
    generatedAt: new Date('2026-07-10T12:00:00.000Z'),
    lifecycleState: 'LIKELY_CANDIDATE',
    probability: 0.8,
    topContributingSignals: [
      {
        bundle: 'claim',
        signalName: 'email_domain_match',
        outcome: 'SUPPORTS',
        decayedLogLikelihoodRatio: 0.15,
        occurredAt: new Date(),
      },
    ],
    contradictoryEvidence: [],
    missingEvidence: [],
    alternativeHypotheses: [],
    ...overrides,
  };
}

describe('LlmNarrativeAdapter', () => {
  it('rejects a non-positive maxAttempts', () => {
    expect(() => new LlmNarrativeAdapter(new StubLlmProvider(), { maxAttempts: 0 })).toThrow(
      RangeError,
    );
  });

  it('returns a valid narrative from a well-behaved provider', async () => {
    const adapter = new LlmNarrativeAdapter(new StubLlmProvider());
    const narrative = await adapter.generateNarrative(report());

    expect(narrative).not.toBeNull();
    expect(narrative).toContain('session-1');
  });

  it('passes the deterministic prompt (built from the report) to the provider', async () => {
    const provider: LlmProvider = {
      generateNarrative: vi.fn().mockResolvedValue('a fine summary'),
    };
    const adapter = new LlmNarrativeAdapter(provider);

    await adapter.generateNarrative(report());

    expect(provider.generateNarrative).toHaveBeenCalledWith(
      expect.stringContaining('email_domain_match'),
    );
  });

  it('returns null, never throwing, when the provider is unreachable (RFC §13 graceful degradation)', async () => {
    const provider: LlmProvider = {
      generateNarrative: vi.fn().mockRejectedValue(new Error('LLM API unreachable')),
    };
    const adapter = new LlmNarrativeAdapter(provider);

    await expect(adapter.generateNarrative(report())).resolves.toBeNull();
  });

  it('rejects a hallucinating provider and retries, succeeding once a later attempt is valid', async () => {
    const provider: LlmProvider = {
      generateNarrative: vi
        .fn()
        .mockResolvedValueOnce('This candidate also passed face_embedding_self_consistency.') // fabricated
        .mockResolvedValueOnce('The email_domain_match signal supports this candidate.'), // valid
    };
    const adapter = new LlmNarrativeAdapter(provider, { maxAttempts: 3 });

    const narrative = await adapter.generateNarrative(report());

    expect(narrative).toBe('The email_domain_match signal supports this candidate.');
    expect(provider.generateNarrative).toHaveBeenCalledTimes(2);
  });

  it('falls back to null, never displaying a rejected narrative, once every attempt is exhausted', async () => {
    const provider: LlmProvider = {
      generateNarrative: vi
        .fn()
        .mockResolvedValue('This candidate also passed face_embedding_self_consistency.'),
    };
    const adapter = new LlmNarrativeAdapter(provider, { maxAttempts: 2 });

    const narrative = await adapter.generateNarrative(report());

    expect(narrative).toBeNull();
    expect(provider.generateNarrative).toHaveBeenCalledTimes(2);
  });

  it('never affects the report it was given -- the report object is not mutated', async () => {
    const provider: LlmProvider = {
      generateNarrative: vi
        .fn()
        .mockResolvedValue('This candidate also passed face_embedding_self_consistency.'),
    };
    const adapter = new LlmNarrativeAdapter(provider);
    const originalReport = report();
    const snapshot = JSON.stringify(originalReport);

    await adapter.generateNarrative(originalReport);

    expect(JSON.stringify(originalReport)).toBe(snapshot);
  });

  it('makes only one attempt when maxAttempts is 1', async () => {
    const provider: LlmProvider = {
      generateNarrative: vi
        .fn()
        .mockResolvedValue('This candidate also passed face_embedding_self_consistency.'),
    };
    const adapter = new LlmNarrativeAdapter(provider, { maxAttempts: 1 });

    await adapter.generateNarrative(report());

    expect(provider.generateNarrative).toHaveBeenCalledTimes(1);
  });
});
