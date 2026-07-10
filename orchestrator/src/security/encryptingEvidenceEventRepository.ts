import type { BundleName, EvidenceEvent, NewEvidenceEvent } from '@sherlock/contracts';

import type { EvidenceEventRepository } from '../persistence/index.js';
import type { EncryptedField } from './fieldEncryption.js';
import { decryptField, encryptField } from './fieldEncryption.js';

/**
 * Encryption at rest for biometric derivatives (RFC §15/Pilot-readiness
 * bar; Plan M16: "Privacy & Compliance Layer integrated across Evidence
 * Store"). A decorator around any `EvidenceEventRepository` — M1's
 * `InMemoryEvidenceEventRepository`/`PostgresEvidenceEventRepository`
 * classes are completely untouched; this class wraps whichever one a
 * caller already constructed, encrypting `value` on the way in for the
 * bundles that carry biometric-derived signals and transparently
 * decrypting it on the way out, so every other module downstream
 * (`FusionEngine`, `ExplanationEngine`, ...) keeps working against
 * plain `EvidenceEvent`s exactly as before.
 *
 * Scope note, stated honestly: this codebase never persists a raw
 * embedding vector at all (`VisualBundleAdapter`/`AudioBundleAdapter`,
 * M9, only ever store a derived similarity score / liveness flag /
 * change-point flag — the actual embedding lives only transiently in
 * `EmbeddingSelfConsistencyTracker`'s in-memory running mean, never
 * written to the Evidence Store). That is itself a stronger privacy
 * property than encryption alone. This layer still encrypts the
 * *derived* Visual/Audio values that genuinely are persisted, as
 * defense-in-depth against a raw database dump revealing per-timestamp
 * liveness/consistency metadata.
 */
const ENCRYPTED_BUNDLES: ReadonlySet<BundleName> = new Set(['visual', 'audio']);

interface EncryptedValueEnvelope extends EncryptedField {
  readonly __sherlockEncrypted: true;
}

function isEncryptedEnvelope(value: unknown): value is EncryptedValueEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __sherlockEncrypted?: unknown }).__sherlockEncrypted === true
  );
}

export class EncryptingEvidenceEventRepository implements EvidenceEventRepository {
  constructor(
    private readonly inner: EvidenceEventRepository,
    private readonly encryptionKey: string,
  ) {}

  async append(event: NewEvidenceEvent): Promise<EvidenceEvent> {
    if (!ENCRYPTED_BUNDLES.has(event.bundle) || event.value === null) {
      return this.inner.append(event);
    }

    const encrypted = encryptField(JSON.stringify(event.value), this.encryptionKey);
    const envelope: EncryptedValueEnvelope = { __sherlockEncrypted: true, ...encrypted };
    const persisted = await this.inner.append({ ...event, value: envelope });

    // Return the plaintext value to the immediate caller -- the encryption is a storage-layer
    // concern; every in-process consumer of `append`'s return value should never need to know
    // about it.
    return { ...persisted, value: event.value };
  }

  async listBySession(
    sessionId: string,
    options?: { readonly limit?: number; readonly offset?: number },
  ): Promise<readonly EvidenceEvent[]> {
    const events = await this.inner.listBySession(sessionId, options);
    return events.map((event) => this.decryptIfNeeded(event));
  }

  async listAllBySession(sessionId: string): Promise<readonly EvidenceEvent[]> {
    const events = await this.inner.listAllBySession(sessionId);
    return events.map((event) => this.decryptIfNeeded(event));
  }

  private decryptIfNeeded(event: EvidenceEvent): EvidenceEvent {
    if (!isEncryptedEnvelope(event.value)) return event;
    const plaintext = decryptField(event.value, this.encryptionKey);
    return { ...event, value: JSON.parse(plaintext) };
  }
}
