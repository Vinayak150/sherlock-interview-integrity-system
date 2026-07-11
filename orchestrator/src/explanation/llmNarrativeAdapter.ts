import type { LLMProvider } from '../llm/index.js';
import { buildLLMExplanationRequest } from '../llm/requestBuilder.js';
import { validateNarrative } from './narrativeValidator.js';
import type { EvidenceReport } from './types.js';

/**
 * The constrained LLM narrative layer (RFC §8; Plan M12): "add the
 * constrained, fact-validated prose layer on top of [the] structured
 * report, fully optional/degradable per §13."
 *
 * `generateNarrative` never throws — an unreachable provider, or a
 * provider that keeps producing unsupported claims across every retry,
 * both resolve to `null` (no narrative available). This is the exact
 * shape of RFC §13's "LLM unavailable" row: "score and state entirely
 * unaffected" — this class has no channel back into the Fusion Engine,
 * the Lifecycle FSM, or the Decision Engine; it only ever consumes an
 * already-built `EvidenceReport` and produces prose, or nothing.
 */
export interface LlmNarrativeAdapterOptions {
  /** Total attempts (initial + retries) before falling back to `null`. Must be at least 1. */
  readonly maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 2;

export class LlmNarrativeAdapter {
  private readonly maxAttempts: number;

  constructor(
    private readonly provider: LLMProvider,
    options: LlmNarrativeAdapterOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    if (!(this.maxAttempts >= 1)) {
      throw new RangeError(`maxAttempts must be at least 1, received ${this.maxAttempts}`);
    }
  }

  async generateNarrative(report: EvidenceReport): Promise<string | null> {
    const request = buildLLMExplanationRequest(report);

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      let candidate: string;
      try {
        const response = await this.provider.generateExplanation(request);
        candidate = response.reviewerExplanation;
      } catch {
        // RFC §13: "LLM unavailable" degrades gracefully -- never propagated as an error.
        return null;
      }

      const validation = validateNarrative(candidate, report);
      if (validation.valid) {
        return candidate;
      }
      // RFC §8: "any signal name mentioned that isn't in the source object is rejected and
      // regenerated" -- loop to the next attempt rather than displaying it.
    }

    // Exhausted every attempt without a valid narrative -- fall back to no narrative, never a
    // rejected one.
    return null;
  }
}
