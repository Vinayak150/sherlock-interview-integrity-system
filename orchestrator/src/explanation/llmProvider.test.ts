import { describe, expect, it } from 'vitest';

import { StubLlmProvider } from './llmProvider.js';

describe('StubLlmProvider', () => {
  it('returns a string that includes the prompt content', async () => {
    const provider = new StubLlmProvider();
    const result = await provider.generateNarrative('some prompt facts here');
    expect(result).toContain('some prompt facts here');
  });

  it('is clearly labeled as a template, not a real model', async () => {
    const provider = new StubLlmProvider();
    const result = await provider.generateNarrative('facts');
    expect(result.toLowerCase()).toContain('not a real llm');
  });
});
