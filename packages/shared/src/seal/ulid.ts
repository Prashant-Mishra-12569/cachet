import { randomBytes } from 'node:crypto';

/** Crockford base32, as used by ULID. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ULID_FORMAT = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/**
 * ULID: 48-bit millisecond time + 80 random bits, 26 chars. Sortable by creation time and
 * unguessable (2^80 random space), so seal IDs can appear in public links.
 */
export function ulid(now: number = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 2 ** 48 - 1)
    throw new RangeError('ULID time out of range');
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  // 80 random bits = 16 base32 chars of 5 bits each.
  const bytes = randomBytes(10);
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let random = '';
  for (let i = 0; i < 16; i++) {
    random = ALPHABET[Number(bits & 31n)] + random;
    bits >>= 5n;
  }
  return time + random;
}

/** Milliseconds encoded in a ULID. */
export function ulidTime(id: string): number {
  if (!ULID_FORMAT.test(id)) throw new Error('not a ULID');
  let t = 0;
  for (const ch of id.slice(0, 10)) t = t * 32 + ALPHABET.indexOf(ch);
  return t;
}
