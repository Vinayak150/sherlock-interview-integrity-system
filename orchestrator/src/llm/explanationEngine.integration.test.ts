import { describe, expect, it } from 'vitest';

import { ExplanationEngine } from '../explanation/explanationEngine.js';
import { emptyStructuredEvidenceSummary } from '../explanation/evidenceSummary.js';
import type { EvidenceReport } from '../explanation/types.js';
import { StubLLMProvider } from './stubProvider.js';

function report(): EvidenceReport {
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

  return {
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
      strongestSupportingEvidence: supporting,
    }),
  };
}

describe('ExplanationEngine LLM integration', () => {
  it('buildReport remains deterministic without a provider', () => {
    const engine = new ExplanationEngine();
    const built = engine.buildReport({
      sessionId: 'session-1',
      lifecycleState: 'UNKNOWN',
      posterior: {
        sessionId: 'session-1',
        evaluatedAt: new Date('2026-07-10T12:00:00.000Z'),
        logOdds: 0,
        probability: 0.5,
        beta: { alpha: 1, beta: 1 },
        credibleInterval: { lower: 0.1, upper: 0.9, mass: 0.9 },
        bundleContributions: [],
        eligibleEventCount: 0,
      },
      events: [],
    });

    expect(built.sessionId).toBe('session-1');
    expect(built.summary.confidence).toBe(0.5);
  });

  it('delegates structured explanation generation to an injected LLMProvider', async () => {
    const engine = new ExplanationEngine({ llmProvider: new StubLLMProvider() });
    const explanation = await engine.generateExplanation(report());

    expect(explanation).not.toBeNull();
    expect(explanation?.provider).toBe('stub');
    expect(explanation?.reviewerExplanation).toContain('email_domain_match');
  });

  it('returns null when no provider is configured', async () => {
    const engine = new ExplanationEngine();
    await expect(engine.generateExplanation(report())).resolves.toBeNull();
  });
});
