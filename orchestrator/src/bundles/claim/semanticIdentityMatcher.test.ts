import { describe, expect, it } from 'vitest';

import { matchIdentityField } from './semanticIdentityMatcher.js';

describe('semanticIdentityMatcher', () => {
  it('matches reordered names', () => {
    const result = matchIdentityField({
      observed: 'Doe, Jane',
      claimed: 'Jane Doe',
      kind: 'display_name',
    });
    expect(result.matched).toBe(true);
    expect(result.similarity).toBeGreaterThan(0.9);
    expect(result.matchedFields).toContain('reordered_name');
  });

  it('matches nicknames', () => {
    const result = matchIdentityField({
      observed: 'Bob Smith',
      claimed: 'Robert Smith',
      kind: 'display_name',
    });
    expect(result.matched).toBe(true);
    expect(result.matchedFields).toContain('nickname');
  });

  it('matches abbreviations and initials', () => {
    const abbreviation = matchIdentityField({
      observed: 'J. Doe',
      claimed: 'Jane Doe',
      kind: 'display_name',
    });
    expect(abbreviation.matched).toBe(true);
    expect(abbreviation.matchedFields).toEqual(
      expect.arrayContaining(['abbreviation', 'initials']),
    );

    const initials = matchIdentityField({
      observed: 'J D',
      claimed: 'Jane Doe',
      kind: 'display_name',
    });
    expect(initials.matched).toBe(true);
    expect(initials.matchedFields).toContain('initials');
  });

  it('tolerates minor typos in display names', () => {
    const result = matchIdentityField({
      observed: 'Jhon Smith',
      claimed: 'John Smith',
      kind: 'display_name',
    });
    expect(result.matched).toBe(true);
    expect(result.similarity).toBeGreaterThanOrEqual(0.78);
  });

  it('matches filed aliases', () => {
    const result = matchIdentityField({
      observed: 'Liz Doe',
      claimed: 'Elizabeth Doe',
      aliases: ['Liz Doe'],
      kind: 'display_name',
    });
    expect(result.matched).toBe(true);
    expect(result.matchedFields).toContain('alias');
  });

  it('matches email domains exactly while exposing similarity metadata', () => {
    const result = matchIdentityField({
      observed: 'jane+interview@corp.example.com',
      claimed: 'jane.doe@corp.example.com',
      kind: 'email',
    });
    expect(result.matched).toBe(true);
    expect(result.matchedFields).toContain('email_domain');
    expect(result.similarity).toBeGreaterThan(0.8);
  });

  it('matches calendar invite emails with local-part typos', () => {
    const result = matchIdentityField({
      observed: 'jane.doe@corp.example.com',
      claimed: 'jane.doe@corp.example.com',
      kind: 'calendar_invite',
    });
    expect(result.matched).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('rejects clearly different names', () => {
    const result = matchIdentityField({
      observed: 'John Smith',
      claimed: 'Jane Doe',
      kind: 'display_name',
    });
    expect(result.matched).toBe(false);
    expect(result.similarity).toBeLessThan(0.78);
  });
});
