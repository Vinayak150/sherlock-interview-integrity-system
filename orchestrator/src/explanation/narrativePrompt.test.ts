import { describe, expect, it } from 'vitest';

import { buildNarrativePrompt } from './narrativePrompt.js';
import type { EvidenceReport } from './types.js';

function report(overrides: Partial<EvidenceReport> = {}): EvidenceReport {
  return {
    sessionId: 'session-1',
    generatedAt: new Date('2026-07-10T12:00:00.000Z'),
    lifecycleState: 'LIKELY_CANDIDATE',
    probability: 0.812,
    topContributingSignals: [],
    contradictoryEvidence: [],
    missingEvidence: [],
    alternativeHypotheses: [],
    ...overrides,
  };
}

describe('buildNarrativePrompt', () => {
  it('includes the sessionId, lifecycleState, and probability', () => {
    const prompt = buildNarrativePrompt(report());
    expect(prompt).toContain('session-1');
    expect(prompt).toContain('LIKELY_CANDIDATE');
    expect(prompt).toContain('0.812');
  });

  it('lists every contributing signal with its outcome', () => {
    const prompt = buildNarrativePrompt(
      report({
        topContributingSignals: [
          {
            bundle: 'claim',
            signalName: 'email_domain_match',
            outcome: 'SUPPORTS',
            decayedLogLikelihoodRatio: 0.15,
            occurredAt: new Date(),
          },
        ],
      }),
    );
    expect(prompt).toContain('claim/email_domain_match');
    expect(prompt).toContain('SUPPORTS');
  });

  it('lists contradictory evidence separately', () => {
    const prompt = buildNarrativePrompt(
      report({
        contradictoryEvidence: [
          {
            bundle: 'visual',
            signalName: 'visual_liveness',
            outcome: 'CONTRADICTS',
            decayedLogLikelihoodRatio: -0.5,
            occurredAt: new Date(),
          },
        ],
      }),
    );
    expect(prompt).toContain('visual/visual_liveness');
  });

  it('lists missing evidence with its health status', () => {
    const prompt = buildNarrativePrompt(
      report({
        missingEvidence: [
          {
            bundle: 'claim',
            signalName: 'calendar_invite_match',
            healthStatus: 'NO_SIGNAL_DETECTED',
            occurredAt: new Date(),
          },
        ],
      }),
    );
    expect(prompt).toContain('claim/calendar_invite_match');
    expect(prompt).toContain('NO_SIGNAL_DETECTED');
  });

  it('renders "(none)" placeholders for empty sections rather than omitting them', () => {
    const prompt = buildNarrativePrompt(report());
    const noneCount = prompt.split('(none)').length - 1;
    expect(noneCount).toBe(3); // top signals, contradictory evidence, missing evidence
  });

  it('is deterministic for the same report', () => {
    const r = report();
    expect(buildNarrativePrompt(r)).toBe(buildNarrativePrompt(r));
  });
});
