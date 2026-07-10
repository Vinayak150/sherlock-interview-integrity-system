import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { EvidencePersistenceValidationError } from './errors.js';
import {
  assertNonEmptySessionId,
  clampListLimit,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  toPersistenceValidationError,
  zodIssueMessages,
} from './validation.js';

describe('zodIssueMessages', () => {
  it('formats each issue as "path: message"', () => {
    const schema = z.object({ sessionId: z.string().min(1) });
    const result = schema.safeParse({ sessionId: '' });
    expect(result.success).toBe(false);
    if (result.success) return;

    const messages = zodIssueMessages(result.error);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/^sessionId: /);
  });

  it('renders a root-level issue path as "(root)"', () => {
    const schema = z.string();
    const result = schema.safeParse(42);
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(zodIssueMessages(result.error)[0]).toMatch(/^\(root\): /);
  });
});

describe('toPersistenceValidationError', () => {
  it('converts a ZodError into an EvidencePersistenceValidationError', () => {
    const schema = z.object({ sessionId: z.string().min(1) });
    const result = schema.safeParse({ sessionId: '' });
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(() => toPersistenceValidationError(result.error, 'Invalid input')).toThrow(
      EvidencePersistenceValidationError,
    );
  });

  it('rethrows a non-Zod error unchanged', () => {
    const original = new Error('not a zod error');
    expect(() => toPersistenceValidationError(original, 'context')).toThrow(original);
  });
});

describe('assertNonEmptySessionId', () => {
  it('accepts a non-empty sessionId', () => {
    expect(() => assertNonEmptySessionId('session-1')).not.toThrow();
  });

  it('rejects an empty or whitespace-only sessionId', () => {
    expect(() => assertNonEmptySessionId('')).toThrow(EvidencePersistenceValidationError);
    expect(() => assertNonEmptySessionId('   ')).toThrow(EvidencePersistenceValidationError);
  });
});

describe('clampListLimit', () => {
  it('returns the default limit when undefined', () => {
    expect(clampListLimit(undefined)).toBe(DEFAULT_LIST_LIMIT);
  });

  it('returns the requested limit when within range', () => {
    expect(clampListLimit(10)).toBe(10);
  });

  it('clamps a limit above the maximum', () => {
    expect(clampListLimit(MAX_LIST_LIMIT + 1000)).toBe(MAX_LIST_LIMIT);
  });

  it('rejects a zero or negative limit', () => {
    expect(() => clampListLimit(0)).toThrow(EvidencePersistenceValidationError);
    expect(() => clampListLimit(-5)).toThrow(EvidencePersistenceValidationError);
  });

  it('rejects a non-integer limit', () => {
    expect(() => clampListLimit(1.5)).toThrow(EvidencePersistenceValidationError);
  });
});
