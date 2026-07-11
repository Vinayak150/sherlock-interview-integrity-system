import type {
  LLMExplanationRequest,
  LLMExplanationResponse,
  LLMHealthCheckResponse,
} from './types.js';

/**
 * Production LLM provider contract. Implementations receive structured
 * explanation facts only and return provider-agnostic prose. No network
 * calls are implied by this interface — each implementation decides how
 * to fulfil the contract.
 */
export interface LLMProvider {
  generateExplanation(input: LLMExplanationRequest): Promise<LLMExplanationResponse>;
  healthCheck(): Promise<LLMHealthCheckResponse>;
  providerName(): string;
  supportsStructuredOutput(): boolean;
}

export class LLMProviderUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'LLMProviderUnavailableError';
  }
}
