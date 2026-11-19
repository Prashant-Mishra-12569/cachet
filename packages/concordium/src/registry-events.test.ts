import { AccountAddress } from '@concordium/web-sdk';
import { describe, expect, it } from 'vitest';
import { decodeRegistryEvent } from './registry-events';

const OWNER = '3tCvWPDYchFULvGXKc6Q3MzofopAgMzzL3KeRU66G2dM2LqcNa';
const ownerBytes = () => Array.from(AccountAddress.toBuffer(AccountAddress.fromBase58(OWNER)));
const tokenId = (n: number) => [8, n, 0, 0, 0, 0, 0, 0, 0];
const str = (s: string) => {
  const b = Array.from(new TextEncoder().encode(s));
  return [b.length & 0xff, (b.length >> 8) & 0xff, 0, 0, ...b];
};
const ev = (...parts: number[][]) => Uint8Array.from(parts.flat());

describe('decodeRegistryEvent', () => {
  it('reads Registered with no URI or hash (our register call)', () => {
    expect(decodeRegistryEvent(ev([240], tokenId(42), ownerBytes(), [0], [0], [0]))).toEqual({
      type: 'Registered',
      tokenId: 42n,
      owner: OWNER,
      agentUri: null,
      metadataHash: null,
    });
  });

  it('reads URIUpdated with a URI and hash', () => {
    const hash = Array.from({ length: 32 }, (_, i) => i);
    const decoded = decodeRegistryEvent(
      ev([241], tokenId(7), [1], str('https://x.example/card.json'), [1], hash),
    );
    expect(decoded).toEqual({
      type: 'URIUpdated',
      tokenId: 7n,
      agentUri: 'https://x.example/card.json',
      metadataHash: Buffer.from(hash).toString('hex'),
    });
  });

  it('reads AgentWalletSet (register sets the wallet to the owner)', () => {
    expect(decodeRegistryEvent(ev([245], tokenId(42), [1], ownerBytes()))).toEqual({
      type: 'AgentWalletSet',
      tokenId: 42n,
      wallet: OWNER,
    });
    expect(decodeRegistryEvent(ev([245], tokenId(42), [0]))).toMatchObject({ wallet: null });
  });

  it('reads Revoked with a reason', () => {
    expect(decodeRegistryEvent(ev([244], tokenId(1), ownerBytes(), [1], str('stolen key')))).toMatchObject({
      type: 'Revoked',
      tokenId: 1n,
      reason: 'stolen key',
    });
  });

  it('reads large token ids exactly (u64 little-endian)', () => {
    const big = [8, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f];
    expect(decodeRegistryEvent(ev([245], big, [0]))).toMatchObject({ tokenId: 0x7fffffffffffffffn });
  });

  it('decodes a REAL testnet Registered event, given as a Node Buffer (with the extra timestamp)', () => {
    // Token 1294, tx 415fe1e3… on testnet (19 Nov 2026). Node Buffers share a memory pool.
    const raw =
      'f0080e050000000000000335dc195c80d2f0cfabca5ee8f44e988d3de7c4e0ea89f5eb8a3579105075660000007b9d53f4a1010000';
    const decoded = decodeRegistryEvent(Buffer.from(raw, 'hex'));
    expect(decoded).toMatchObject({ type: 'Registered', tokenId: 1294n, agentUri: null, metadataHash: null });
    expect((decoded as { owner: string }).owner).toMatch(/^[1-9A-HJ-NP-Za-km-z]{50}$/);
  });

  it('reports CIS-2 and unknown events as other', () => {
    expect(decodeRegistryEvent(ev([254], [1, 2, 3]))).toEqual({ type: 'other', tag: 254 });
  });

  it.each([
    ['truncated', ev([240], tokenId(1))],
    ['bad token id prefix', ev([245], [4, 1, 0, 0, 0], [0])],
    ['bad option tag', ev([245], tokenId(1), [7])],
  ])('rejects %s input', (_name, bytes) => {
    expect(() => decodeRegistryEvent(bytes)).toThrow();
  });
});
