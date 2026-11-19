import { createHmac } from 'node:crypto';

export const E164 = /^\+[1-9]\d{6,14}$/;

/** Accepts "+91 93361 24858", "+91-933-612-4858" … Returns E.164 or undefined. */
export function normalizeE164(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('+')) return undefined;
  const cleaned = `+${trimmed.slice(1).replace(/[\s().-]/g, '')}`;
  return E164.test(cleaned) ? cleaned : undefined;
}

/**
 * Keyed fingerprint of a phone number. Seals, anchors and lookups use this, never the number.
 * Without the secret pepper, nobody can turn the hash back into a number by trying all numbers.
 */
export function phoneHash(pepper: string | Buffer, e164: string): string {
  if (!E164.test(e164)) throw new Error('phoneHash needs an E.164 number');
  return `hmac-sha256:${createHmac('sha256', pepper).update(`cachet:phone:v1:${e164}`).digest('hex')}`;
}
