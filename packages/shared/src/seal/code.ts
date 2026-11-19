import { createHmac } from 'node:crypto';

const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** Codes people might guess or a scammer might say by chance: 0000, 1234, 9876, 1212 … */
export function isWeakCode(code: string): boolean {
  const d = [...code].map(Number);
  if (d.length !== 4 || d.some((n) => !Number.isInteger(n))) return true;
  const [a, b, c, e] = d as [number, number, number, number];
  if (a === b && b === c && c === e) return true; // 0000, 7777
  if (b - a === 1 && c - b === 1 && e - c === 1) return true; // 0123 … 6789
  if (a - b === 1 && b - c === 1 && c - e === 1) return true; // 9876 … 3210
  if (a === c && b === e) return true; // 1212, 4747
  if (a === b && c === e) return true; // 1122
  return false;
}

/**
 * The 4-digit call code for a seal: HMAC-SHA256(secret, sealId) mapped to 0000–9999 without bias
 * (rejection sampling), skipping weak codes. Deterministic: the same seal always gets the same code.
 */
export function callCode(secret: string | Buffer, sealId: string): string {
  const limit = Math.floor(2 ** 32 / 10_000) * 10_000; // reject above this → uniform 0..9999
  for (let attempt = 0; attempt < 1_000; attempt++) {
    const mac = createHmac('sha256', secret).update(`cachet:code:v1:${sealId}:${attempt}`).digest();
    for (let off = 0; off + 4 <= mac.length; off += 4) {
      const n = mac.readUInt32BE(off);
      if (n >= limit) continue;
      const code = String(n % 10_000).padStart(4, '0');
      if (!isWeakCode(code)) return code;
    }
  }
  throw new Error('could not derive a call code'); // practically unreachable
}

/** "4721" → "47-21" (how it is shown on screens). */
export const formatCode = (code: string) => `${code.slice(0, 2)}-${code.slice(2)}`;

/** "4721" → "four-seven, two-one" (how the AI voice says it, slowly, in two pairs). */
export function spokenCode(code: string): string {
  const w = [...code].map((c) => DIGIT_WORDS[Number(c)] ?? c);
  return `${w[0]}-${w[1]}, ${w[2]}-${w[3]}`;
}
