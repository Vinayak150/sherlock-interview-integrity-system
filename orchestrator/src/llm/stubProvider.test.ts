import { describe, expect, it } from 'vitest';

import { LLMProviderFactory } from './factory.js';
import { buildLLMExplanationRequest } from './requestBuilder.js';
import { StubLLMProvider } from './stubProvider.js';
import { emptyStructuredEvidenceSummary } from '../explanation/evidenceSummary.js';
import type { EvidenceReport } from '../explanation/types.js';

function requestFixture() {
  const evaluatedAt = new Date('2026-07-10T12:00:00.000Z');
  const supporting = [
    {
      bundle: 'claim' as const,
      signalName: 'email_domain_match',
      outcome: 'SUPPORTS' as const,
      decayedLogLikelihoodRatio: 0.15,
      occurredAt: evaluatedAt,
    },
  ];
  const report: EvidenceReport = {
    sessionId: 'session-1',
    generatedAt: evaluatedAt,
    lifecycleState: 'LIKELY_CANDIDATE',
    probability: 0.82,
    topContributingSignals: supporting,
    contradictoryEvidence: [],
    missingEvidence: [],
    alternativeHypotheses: [],
    summary: emptyStructuredEvidenceSummary({
      confidence: 0.82,
      uncertainty: 0.2,
      recommendation: 'MONITOR',
      strongestSupportingEvidence: supporting,
    }),
  };

  return buildLLMExplanationRequest(report, [
    {
      participantId: 'candidate-a',
      probability: 0.82,
      confidence: 0.82,
      identificationState: 'IDENTIFIED',
    },
  ]);
}

describe('StubLLMProvider', () => {
  it('is always healthy and advertises structured output support', async () => {
    const provider = new StubLLMProvider();
    const health = await provider.healthCheck();

    expect(health).toEqual({
      status: 'healthy',
      provider: 'stub',
      version: '1.0.0',
      supportsStructuredOutput: true,
    });
    expect(provider.providerName()).toBe('stub');
    expect(provider.supportsStructuredOutput()).toBe(true);
  });

  it('generates deterministic structured explanations for the same input', async () => {
    const provider = new StubLLMProvider();
    const input = requestFixture();

    const first = await provider.generateExplanation(input);
    const second = await provider.generateExplanation(input);

    expect(first).toEqual(second);
    expect(first.provider).toBe('stub');
    expect(first.generatedAt).toBe(input.evaluatedAt.toISOString());
    expect(first.reviewerExplanation).toContain('session-1');
    expect(first.reviewerExplanation).toContain('email_domain_match');
  });

  it('never performs network I/O', async () => {
    const provider = new StubLLMProvider();
    const response = await provider.generateExplanation(requestFixture());
    expect(response.executiveSummary.length).toBeGreaterThan(0);
    expect(response.reasoning.length).toBeGreaterThan(0);
  });
});

describe('LLMProviderFactory', () => {
  it('creates a StubLLMProvider by default', () => {
    const provider = LLMProviderFactory.create();
    expect(provider.providerName()).toBe('stub');
  });

  it('creates a StubLLMProvider when explicitly requested', () => {
    const provider = LLMProviderFactory.create({ provider: 'stub' });
    expect(provider.supportsStructuredOutput()).toBe(true);
  });
});

describe('buildLLMExplanationRequest', () => {
  it('maps an EvidenceReport into structured-only request fields', () => {
    const input = requestFixture();
    expect(input.sessionId).toBe('session-1');
    expect(input.confidence).toBe(0.82);
    expect(input.recommendation).toBe('MONITOR');
    expect(input.candidateRanking).toHaveLength(1);
    expect(input.topContributingSignals[0]?.signalName).toBe('email_domain_match');
  });
});
