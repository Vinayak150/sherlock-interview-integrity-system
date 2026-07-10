import { describe, expect, it } from 'vitest';

import { EvidencePersistenceValidationError, EvidenceStoreError } from './errors.js';

describe('EvidencePersistenceValidationError', () => {
  it('carries a descriptive message and the structured list of issues', () => {
    const error = new EvidencePersistenceValidationError('Invalid evidence event', [
      'sessionId: must not be empty',
    ]);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EvidencePersistenceValidationError');
    expect(error.message).toBe('Invalid evidence event');
    expect(error.issues).toEqual(['sessionId: must not be empty']);
  });
});

describe('EvidenceStoreError', () => {
  it('wraps an underlying cause via the standard Error cause chain', () => {
    const cause = new Error('connection refused');
    const error = new EvidenceStoreError('Failed to append evidence event', cause);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EvidenceStoreError');
    expect(error.cause).toBe(cause);
  });

  it('supports being constructed without a cause', () => {
    const error = new EvidenceStoreError('no row returned');

    expect(error.cause).toBeUndefined();
  });
});
