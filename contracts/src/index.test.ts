import { describe, expect, it } from 'vitest';

import { CONTRACTS_PACKAGE_NAME } from './index.js';

describe('@sherlock/contracts scaffold', () => {
  it('builds and exposes a package identity marker', () => {
    expect(CONTRACTS_PACKAGE_NAME).toBe('@sherlock/contracts');
  });
});
