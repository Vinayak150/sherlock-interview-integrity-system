import { describe, expect, it } from 'vitest';

import { FieldDecryptionError, decryptField, encryptField } from './fieldEncryption.js';

describe('encryptField / decryptField', () => {
  it('round-trips a plaintext string', () => {
    const encrypted = encryptField('a secret embedding vector, serialized', 'test-key');
    expect(decryptField(encrypted, 'test-key')).toBe('a secret embedding vector, serialized');
  });

  it('round-trips an empty string', () => {
    const encrypted = encryptField('', 'test-key');
    expect(decryptField(encrypted, 'test-key')).toBe('');
  });

  it('round-trips a large JSON payload (a realistic embedding vector)', () => {
    const payload = JSON.stringify({ embedding: Array.from({ length: 128 }, (_, i) => i / 128) });
    const encrypted = encryptField(payload, 'test-key');
    expect(decryptField(encrypted, 'test-key')).toBe(payload);
  });

  it('produces ciphertext that does not contain the plaintext', () => {
    const encrypted = encryptField('a very identifiable secret string', 'test-key');
    expect(encrypted.ciphertext).not.toContain('a very identifiable secret string');
  });

  it('produces a different ciphertext each time (random IV), even for identical plaintext', () => {
    const first = encryptField('same plaintext', 'test-key');
    const second = encryptField('same plaintext', 'test-key');
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
  });

  it('throws FieldDecryptionError when decrypting with the wrong key', () => {
    const encrypted = encryptField('secret', 'correct-key');
    expect(() => decryptField(encrypted, 'wrong-key')).toThrow(FieldDecryptionError);
  });

  it('throws FieldDecryptionError when the ciphertext has been tampered with', () => {
    const encrypted = encryptField('secret', 'test-key');
    const tampered = {
      ...encrypted,
      ciphertext: Buffer.from('tampered-bytes-here').toString('base64'),
    };
    expect(() => decryptField(tampered, 'test-key')).toThrow(FieldDecryptionError);
  });

  it('throws FieldDecryptionError when the authTag has been tampered with', () => {
    const encrypted = encryptField('secret', 'test-key');
    const tampered = { ...encrypted, authTag: Buffer.from('0000000000000000').toString('base64') };
    expect(() => decryptField(tampered, 'test-key')).toThrow(FieldDecryptionError);
  });

  it('accepts an arbitrary-length key material string (derived via hashing, not used directly)', () => {
    const shortKey = encryptField('secret', 'short');
    const longKey = encryptField('secret', 'a'.repeat(200));
    expect(decryptField(shortKey, 'short')).toBe('secret');
    expect(decryptField(longKey, 'a'.repeat(200))).toBe('secret');
  });
});
