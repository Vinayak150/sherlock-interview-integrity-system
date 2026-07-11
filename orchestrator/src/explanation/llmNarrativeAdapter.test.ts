import { describe, expect, it, vi } from 'vitest';

import { LlmNarrativeAdapter } from './llmNarrativeAdapter.js';
import { emptyStructuredEvidenceSummary } from './evidenceSummary.js';
import type { EvidenceReport } from './types.js';
import type { LLMProvider } from '../llm/index.js';
import { StubLLMProvider } from '../llm/stubProvider.js';

function response(reviewerExplanation: string) {
  return {
    executiveSummary: 'summary',
    reviewerExplanation,
    recommendationSummary: 'recommendation',
    reasoning: ['reason'],
    generatedAt: '2026-07-10T12:00:00.000Z',
    provider: 'mock',
  };
}

function mockProvider(reviewerExplanation: string): LLMProvider {
  return {
    generateExplanation: vi.fn().mockResolvedValue(response(reviewerExplanation)),
    healthCheck: vi.fn(),
    providerName: () => 'mock',
    supportsStructuredOutput: () => true,
  };
}

function report(overrides: Partial<EvidenceReport> = {}): EvidenceReport {
  const { summary: summaryOverride, ...rest } = overrides;
  const supporting = rest.topContributingSignals ?? [
    {
      bundle: 'claim',
      signalName: 'email_domain_match',
      outcome: 'SUPPORTS',
      decayedLogLikelihoodRatio: 0.15,
      occurredAt: new Date(),
    },
  ];
  const baseSummary = emptyStructuredEvidenceSummary({
    confidence: rest.probability ?? 0.8,
    strongestSupportingEvidence: supporting,
  });
  return {
    sessionId: 'session-1',
    generatedAt: new Date('2026-07-10T12:00:00.000Z'),
    lifecycleState: 'LIKELY_CANDIDATE',
    probability: 0.8,
    topContributingSignals: supporting,
    contradictoryEvidence: [],
    missingEvidence: [],
    alternativeHypotheses: [],
    summary: summaryOverride ?? baseSummary,
    ...rest,
  };
}

describe('LlmNarrativeAdapter', () => {
  it('rejects a non-positive maxAttempts', () => {
    expect(() => new LlmNarrativeAdapter(new StubLLMProvider(), { maxAttempts: 0 })).toThrow(
      RangeError,
    );
  });

  it('returns a valid narrative from a well-behaved provider', async () => {
    const adapter = new LlmNarrativeAdapter(new StubLLMProvider());
    const narrative = await adapter.generateNarrative(report());

    expect(narrative).not.toBeNull();
    expect(narrative).toContain('session-1');
  });

  it('passes a structured explanation request built from the report to the provider', async () => {
    const provider = mockProvider('a fine summary');
    const adapter = new LlmNarrativeAdapter(provider);

    await adapter.generateNarrative(report());

    expect(provider.generateExplanation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        topContributingSignals: expect.arrayContaining([
          expect.objectContaining({ signalName: 'email_domain_match' }),
        ]),
      }),
    );
  });

  it('returns null, never throwing, when the provider is unreachable (RFC §13 graceful degradation)', async () => {
    const provider: LLMProvider = {
      generateExplanation: vi.fn().mockRejectedValue(new Error('LLM API unreachable')),
      healthCheck: vi.fn(),
      providerName: () => 'mock',
      supportsStructuredOutput: () => true,
    };
    const adapter = new LlmNarrativeAdapter(provider);

    await expect(adapter.generateNarrative(report())).resolves.toBeNull();
  });

  it('rejects a hallucinating provider and retries, succeeding once a later attempt is valid', async () => {
    const provider: LLMProvider = {
      generateExplanation: vi
        .fn()
        .mockResolvedValueOnce(
          response('This candidate also passed face_embedding_self_consistency.'),
        )
        .mockResolvedValueOnce(
          response('The email_domain_match signal supports this candidate.'),
        ),
      healthCheck: vi.fn(),
      providerName: () => 'mock',
      supportsStructuredOutput: () => true,
    };
    const adapter = new LlmNarrativeAdapter(provider, { maxAttempts: 3 });

    const narrative = await adapter.generateNarrative(report());

    expect(narrative).toBe('The email_domain_match signal supports this candidate.');
    expect(provider.generateExplanation).toHaveBeenCalledTimes(2);
  });

  it('falls back to null, never displaying a rejected narrative, once every attempt is exhausted', async () => {
    const provider = mockProvider('This candidate also passed face_embedding_self_consistency.');
    const adapter = new LlmNarrativeAdapter(provider, { maxAttempts: 2 });

    const narrative = await adapter.generateNarrative(report());

    expect(narrative).toBeNull();
    expect(provider.generateExplanation).toHaveBeenCalledTimes(2);
  });

  it('never affects the report it was given -- the report object is not mutated', async () => {
    const provider = mockProvider('This candidate also passed face_embedding_self_consistency.');
    const adapter = new LlmNarrativeAdapter(provider);
    const originalReport = report();
    const snapshot = JSON.stringify(originalReport);

    await adapter.generateNarrative(originalReport);

    expect(JSON.stringify(originalReport)).toBe(snapshot);
  });

  it('makes only one attempt when maxAttempts is 1', async () => {
    const provider = mockProvider('This candidate also passed face_embedding_self_consistency.');
    const adapter = new LlmNarrativeAdapter(provider, { maxAttempts: 1 });

    await adapter.generateNarrative(report());

    expect(provider.generateExplanation).toHaveBeenCalledTimes(1);
  });
});
