import type { LLMProvider } from './provider.js';
import { StubLLMProvider } from './stubProvider.js';
import type { LLMProviderFactoryOptions, LLMProviderKind } from './types.js';

const PROVIDER_REGISTRY: Record<LLMProviderKind, () => LLMProvider> = {
  stub: () => new StubLLMProvider(),
};

/**
 * Central factory for LLM providers. Future providers (Grok, OpenAI, Gemini)
 * register here — callers never instantiate provider classes directly.
 */
export class LLMProviderFactory {
  static create(options: LLMProviderFactoryOptions = {}): LLMProvider {
    const kind = options.provider ?? 'stub';
    const factory = PROVIDER_REGISTRY[kind];
    if (factory === undefined) {
      throw new RangeError(`unsupported LLM provider kind: ${kind}`);
    }
    return factory();
  }
}
