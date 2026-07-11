import type { LLMProvider } from './provider.js';
import type { LLMExplanationRequest, LLMExplanationResponse, LLMHealthCheckResponse } from './types.js';

const PROVIDER_NAME = 'stub';
const PROVIDER_VERSION = '1.0.0';

function formatRecommendation(recommendation: LLMExplanationRequest['recommendation']): string {
  switch (recommendation) {
    case 'NONE':
      return 'No special reviewer action is required at this time.';
    case 'DEFER_TO_ORDINARY_JUDGMENT':
      return 'Defer to ordinary interview judgment while evidence remains sparse.';
    case 'MONITOR':
      return 'Continue monitoring — confidence has weakened but not catastrophically.';
    case 'ADJUDICATE':
      return 'Adjudicate manually — evidence is confidently ambiguous.';
    case 'MANDATORY_REVIEW':
      return 'Mandatory human review is required before any consequential action.';
  }
}

function supportingNarrative(input: LLMExplanationRequest): string {
  const strongest = input.structuredSummary.strongestSupportingEvidence[0];
  if (strongest !== undefined) {
    return `The ${strongest.signalName} signal (${strongest.bundle}) supports the current assessment.`;
  }

  const top = input.topContributingSignals[0];
  if (top !== undefined) {
    const verb = top.outcome === 'SUPPORTS' ? 'supports' : 'weighs against';
    return `The ${top.signalName} signal (${top.bundle}) ${verb} the current assessment.`;
  }

  return 'No strong supporting signals were observed in this evaluation window.';
}

function contradictionNarrative(input: LLMExplanationRequest): string | null {
  const contradiction = input.contradictionReasoning;
  if (contradiction === null || contradiction.strongestContradictions.length === 0) {
    return null;
  }

  const top = contradiction.strongestContradictions[0];
  if (top === undefined) {
    return null;
  }

  return `Contradiction detected via ${top.evidenceSource.signalName} (${top.evidenceSource.bundle}).`;
}

function crossModalNarrative(input: LLMExplanationRequest): string | null {
  const crossModal = input.crossModalReasoning;
  if (crossModal === null) {
    return null;
  }

  return `Cross-modal consistency is ${crossModal.crossModalConsistency.toFixed(2)} across face, speaker, metadata, and transcript modalities.`;
}

/**
 * Deterministic, network-free provider that demonstrates the structured
 * response shape a future Grok/OpenAI/Gemini provider would return.
 */
export class StubLLMProvider implements LLMProvider {
  providerName(): string {
    return PROVIDER_NAME;
  }

  supportsStructuredOutput(): boolean {
    return true;
  }

  async healthCheck(): Promise<LLMHealthCheckResponse> {
    return {
      status: 'healthy',
      provider: PROVIDER_NAME,
      version: PROVIDER_VERSION,
      supportsStructuredOutput: true,
    };
  }

  async generateExplanation(input: LLMExplanationRequest): Promise<LLMExplanationResponse> {
    const supporting = supportingNarrative(input);
    const contradiction = contradictionNarrative(input);
    const crossModal = crossModalNarrative(input);

    const reviewerExplanation = [
      `Session ${input.sessionId} is in lifecycle state ${input.lifecycleState}.`,
      supporting,
      `Confidence is ${input.confidence.toFixed(3)} with credible-interval width ${input.uncertainty.toFixed(3)}.`,
      formatRecommendation(input.recommendation),
    ].join(' ');

    const reasoning = [
      supporting,
      ...(contradiction === null ? [] : [contradiction]),
      ...(crossModal === null ? [] : [crossModal]),
    ];

    const topCandidate = input.candidateRanking[0];
    const executiveSummary =
      topCandidate === undefined
        ? `Session ${input.sessionId}: ${input.lifecycleState} at confidence ${input.confidence.toFixed(3)}.`
        : `Session ${input.sessionId}: top candidate ${topCandidate.participantId} at confidence ${topCandidate.confidence.toFixed(3)} (${input.lifecycleState}).`;

    return {
      executiveSummary,
      reviewerExplanation,
      recommendationSummary: formatRecommendation(input.recommendation),
      reasoning,
      generatedAt: input.evaluatedAt.toISOString(),
      provider: PROVIDER_NAME,
    };
  }
}
