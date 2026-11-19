import { createHash } from 'node:crypto';

/**
 * Merkle tree over 32-byte item hashes, used to anchor many seals in one on-chain record.
 *
 *   leaf node     = sha256(0x00 || itemHash)
 *   internal node = sha256(0x01 || min(a, b) || max(a, b))      (sorted pair)
 *
 * The 0x00/0x01 prefixes stop a leaf from ever being passed off as an internal node.
 * Sorted pairs make proofs a plain list of sibling hashes (no left/right flags).
 * An odd node at the end of a level is carried up unchanged.
 */

const sha256 = (...parts: Buffer[]) => createHash('sha256').update(Buffer.concat(parts)).digest();
const HEX32 = /^[0-9a-f]{64}$/;

function toBuf(hex: string): Buffer {
  if (!HEX32.test(hex)) throw new Error('Merkle items must be 32-byte lowercase hex');
  return Buffer.from(hex, 'hex');
}

export const leafNode = (itemHash: string) => sha256(Buffer.from([0]), toBuf(itemHash));

function pairNode(a: Buffer, b: Buffer): Buffer {
  const [lo, hi] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return sha256(Buffer.from([1]), lo, hi);
}

export interface MerkleTree {
  root: string;
  /** proofs[i] = sibling hashes (hex) from leaf i up to the root. */
  proofs: string[][];
}

export function buildMerkleTree(itemHashes: readonly string[]): MerkleTree {
  if (itemHashes.length === 0) throw new Error('Merkle tree needs at least one item');
  let level: Buffer[] = itemHashes.map(leafNode);
  // positions[i] = index of item i's ancestor in the current level
  const positions = itemHashes.map((_, i) => i);
  const proofs: string[][] = itemHashes.map(() => []);

  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const right = level[i + 1];
      next.push(right ? pairNode(level[i] as Buffer, right) : (level[i] as Buffer));
    }
    positions.forEach((pos, item) => {
      const sibling = pos % 2 === 0 ? level[pos + 1] : level[pos - 1];
      if (sibling) proofs[item]?.push(sibling.toString('hex'));
      positions[item] = Math.floor(pos / 2);
    });
    level = next;
  }
  return { root: (level[0] as Buffer).toString('hex'), proofs };
}

/** Check that `itemHash` is included under `root` using `proof` (sibling hashes, leaf → root). */
export function verifyMerkleProof(itemHash: string, proof: readonly string[], root: string): boolean {
  try {
    let node: Buffer = leafNode(itemHash);
    for (const sibling of proof) node = pairNode(node, toBuf(sibling));
    return node.toString('hex') === root;
  } catch {
    return false;
  }
}

/** On-chain anchor payload: "CACHET1" (7 ASCII bytes) || root (32 bytes) = 39 bytes (RegisterData max 256). */
export const ANCHOR_TAG = 'CACHET1';
export function anchorPayload(root: string): Uint8Array {
  return Uint8Array.from(Buffer.concat([Buffer.from(ANCHOR_TAG, 'ascii'), toBuf(root)]));
}
export function parseAnchorPayload(bytes: Uint8Array): string | undefined {
  const buf = Buffer.from(bytes);
  if (buf.length !== 39 || buf.subarray(0, 7).toString('ascii') !== ANCHOR_TAG) return undefined;
  return buf.subarray(7).toString('hex');
}
