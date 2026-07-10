import { describe, expect, it } from 'vitest';

import { ConsentStore, InMemoryConsentStorage } from './consent.js';

describe('ConsentStore', () => {
  it('defaults to not granted when no explicit choice has been recorded', async () => {
    const store = new ConsentStore(new InMemoryConsentStorage());
    await expect(store.isGranted()).resolves.toBe(false);
  });

  it('reports granted after grant() is called', async () => {
    const store = new ConsentStore(new InMemoryConsentStorage());
    await store.grant();
    await expect(store.isGranted()).resolves.toBe(true);
  });

  it('reports not granted after decline() is called', async () => {
    const store = new ConsentStore(new InMemoryConsentStorage());
    await store.grant();
    await store.decline();
    await expect(store.isGranted()).resolves.toBe(false);
  });

  it('allows a later grant() to override an earlier decline()', async () => {
    const store = new ConsentStore(new InMemoryConsentStorage());
    await store.decline();
    await store.grant();
    await expect(store.isGranted()).resolves.toBe(true);
  });

  it('persists across separate ConsentStore instances sharing the same storage', async () => {
    const storage = new InMemoryConsentStorage();
    await new ConsentStore(storage).grant();

    const secondInstance = new ConsentStore(storage);
    await expect(secondInstance.isGranted()).resolves.toBe(true);
  });
});
