/**
 * Consent gating (RFC §9.5, ADR-9: "opt-in, clearly-disclosed client-side
 * capture agent"). Every capture path in this package must check
 * `ConsentStore.isGranted()` before emitting anything — declining consent
 * must never itself look like a candidate has something to hide (RFC §7's
 * absence-of-evidence principle, echoed explicitly for this permission by
 * §9.5's own Committee Note).
 *
 * `ConsentStorage` is the narrow port this module depends on (mirroring
 * every other storage abstraction in this codebase) — `chrome.storage`-
 * backed in the real extension, an in-memory fake in tests.
 */
export interface ConsentStorage {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

const CONSENT_STORAGE_KEY = 'sherlock:device-signal-consent';
const GRANTED_VALUE = 'granted';
const DECLINED_VALUE = 'declined';

export class InMemoryConsentStorage implements ConsentStorage {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

export class ConsentStore {
  constructor(private readonly storage: ConsentStorage) {}

  /** Absent any prior explicit choice, consent defaults to *not granted* — an unasked candidate must never be silently opted in. */
  async isGranted(): Promise<boolean> {
    const value = await this.storage.get(CONSENT_STORAGE_KEY);
    return value === GRANTED_VALUE;
  }

  async grant(): Promise<void> {
    await this.storage.set(CONSENT_STORAGE_KEY, GRANTED_VALUE);
  }

  async decline(): Promise<void> {
    await this.storage.set(CONSENT_STORAGE_KEY, DECLINED_VALUE);
  }
}
