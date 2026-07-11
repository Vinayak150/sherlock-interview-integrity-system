import type { EvidenceReport } from './types.js';

/**
 * Deterministically serializes an `EvidenceReport`'s already-computed
 * facts into the prompt handed to the LLM provider (RFC §8: "structured
 * facts ... generated deterministically ... guaranteed accurate by
 * construction"). This function introduces no new facts and makes no
 * decisions — it is pure formatting, so there is nothing here for the LLM
 * layer to hallucinate *from*; whatever it produces is checked against
 * this same report by `narrativeValidator.ts` regardless.
 */
export function buildNarrativePrompt(report: EvidenceReport): string {
  const lines: string[] = [
    `Session: ${report.sessionId}`,
    `Lifecycle state: ${report.lifecycleState}`,
    `Probability: ${report.probability.toFixed(3)}`,
    '',
    'Structured evidence summary:',
    `Confidence: ${report.summary.confidence.toFixed(3)}`,
    `Uncertainty (credible-interval width): ${report.summary.uncertainty.toFixed(3)}`,
    `Recommendation: ${report.summary.recommendation}`,
    '',
    'Strongest supporting evidence:',
  ];

  if (report.summary.strongestSupportingEvidence.length === 0) {
    lines.push('- (none)');
  } else {
    for (const signal of report.summary.strongestSupportingEvidence) {
      lines.push(
        `- ${signal.bundle}/${signal.signalName}: ${signal.outcome} (${signal.decayedLogLikelihoodRatio.toFixed(3)})`,
      );
    }
  }

  lines.push('', 'Conflicting evidence:');
  if (report.summary.conflictingEvidence.length === 0) {
    lines.push('- (none)');
  } else {
    for (const signal of report.summary.conflictingEvidence) {
      lines.push(
        `- ${signal.bundle}/${signal.signalName}: ${signal.outcome} (${signal.decayedLogLikelihoodRatio.toFixed(3)})`,
      );
    }
  }

  lines.push('', 'Missing evidence:');
  if (report.summary.missingEvidence.length === 0) {
    lines.push('- (none)');
  } else {
    for (const item of report.summary.missingEvidence) {
      lines.push(`- ${item.bundle}/${item.signalName} (${item.healthStatus})`);
    }
  }

  lines.push('', 'Top contributing signals (ranked by |log likelihood ratio|):');

  if (report.topContributingSignals.length === 0) {
    lines.push('- (none)');
  } else {
    for (const signal of report.topContributingSignals) {
      lines.push(
        `- ${signal.bundle}/${signal.signalName}: ${signal.outcome} (${signal.decayedLogLikelihoodRatio.toFixed(3)})`,
      );
    }
  }

  lines.push('', 'Contradictory evidence:');
  if (report.contradictoryEvidence.length === 0) {
    lines.push('- (none)');
  } else {
    for (const signal of report.contradictoryEvidence) {
      lines.push(`- ${signal.bundle}/${signal.signalName}`);
    }
  }

  lines.push('', 'Missing evidence:');
  if (report.missingEvidence.length === 0) {
    lines.push('- (none)');
  } else {
    for (const item of report.missingEvidence) {
      lines.push(`- ${item.bundle}/${item.signalName} (${item.healthStatus})`);
    }
  }

  lines.push(
    '',
    'Write a brief, plain-language summary of this evidence for a human reviewer. Reference only the signals listed above. Do not speculate beyond what is listed.',
  );

  return lines.join('\n');
}
