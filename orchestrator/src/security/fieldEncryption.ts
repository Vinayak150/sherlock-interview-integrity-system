import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Field-level encryption at rest for biometric derivatives (RFC §15/
 * Pilot-readiness bar: "encryption at rest ... for biometric
 * derivatives"; Plan M16). AES-256-GCM: authenticated encryption, so a
 * tampered ciphertext fails to decrypt rather than silently returning
 * corrupted data.
 *
 * The configured key string is hashed to a fixed 32-byte key via
 * SHA-256 rather than used directly — this lets `FIELD_ENCRYPTION_KEY`
 * be an arbitrary-length passphrase (as every other `*_dev_password`-
 * style config value in this codebase already is) while still handing
 * `crypto` the exact key length AES-256 requires.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // 96 bits, the standard/recommended GCM IV length.

export interface EncryptedField {
  readonly ciphertext: string; // base64
  readonly iv: string; // base64
  readonly authTag: string; // base64
}

function deriveKey(keyMaterial: string): Buffer {
  return createHash('sha256').update(keyMaterial, 'utf8').digest();
}

export function encryptField(plaintext: string, keyMaterial: string): EncryptedField {
  const key = deriveKey(keyMaterial);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export class FieldDecryptionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'FieldDecryptionError';
  }
}

export function decryptField(encrypted: EncryptedField, keyMaterial: string): string {
  try {
    const key = deriveKey(keyMaterial);
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } catch (error) {
    // Wrong key, or a tampered/corrupted ciphertext -- GCM's authentication tag check fails
    // closed rather than returning silently-corrupted plaintext.
    throw new FieldDecryptionError(
      'Failed to decrypt field -- wrong key or tampered ciphertext',
      error,
    );
  }
}
