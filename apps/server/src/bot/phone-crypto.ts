import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Phone numbers people share with the bot are stored ONLY encrypted:
 * AES-256-GCM with a random 12-byte IV, output base64url(iv | ciphertext | tag).
 * GCM also detects tampering (decryption fails if any byte changed).
 */
export function createPhoneCipher(keyHex: string) {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error('PHONE_ENC_KEY must be 64 hex characters (32 bytes)');
  const key = Buffer.from(keyHex, 'hex');
  return {
    encrypt(e164: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([cipher.update(e164, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64url');
    },
    decrypt(blob: string): string {
      const raw = Buffer.from(blob, 'base64url');
      if (raw.length < 12 + 16 + 1) throw new Error('encrypted phone is too short');
      const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(raw.length - 16));
      return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString(
        'utf8',
      );
    },
  };
}

export type PhoneCipher = ReturnType<typeof createPhoneCipher>;
