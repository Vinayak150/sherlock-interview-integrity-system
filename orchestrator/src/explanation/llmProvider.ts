/**
 * The LLM narrative layer's provider abstraction (RFC §8, ADR-2's LLM
 * half; Plan M12). `Protocol`-shaped so a real model backend can be
 * substituted without touching `LlmNarrativeAdapter` — the same
 * stub-vs-real seam this codebase uses everywhere a real ML dependency
 * isn't trained/licensed as part of this exercise
 * (`embeddings/extractor.py`, `AtsClient`, `EmbeddingExtractor`).
 *
 * The prompt handed to `generateNarrative` is always the deterministic,
 * already-computed structured facts (see `narrativePrompt.ts`) — never
 * raw transcript text treated as instructions (RFC §15's prompt-injection
 * mitigation: "transcript content is always treated as data, never
 * instructions").
 */
export interface LlmProvider {
  generateNarrative(prompt: string): Promise<string>;
}

export class LlmProviderUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'LlmProviderUnavailableError';
  }
}

/**
 * A deterministic, template-based placeholder -- **not a real LLM**. It
 * exists so the validate-and-reject loop and the "LLM unavailable"
 * degradation path (RFC §13) are real and testable end to end before any
 * actual LLM API integration is wired in, mirroring
 * `StubEmbeddingExtractor`'s documented role. Never mistake this for
 * genuine natural-language generation.
 */
export class StubLlmProvider implements LlmProvider {
  async generateNarrative(prompt: string): Promise<string> {
    return `Summary (template, not a real LLM):\n${prompt}`;
  }
}
