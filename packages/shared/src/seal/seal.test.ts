import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  anchorPayload,
  buildMerkleTree,
  callCode,
  canonicalize,
  formatCode,
  isWeakCode,
  keyId,
  loadSealSigningKey,
  normalizeE164,
  parseAnchorPayload,
  phoneHash,
  publicJwk,
  publicKeyFromJwk,
  sealHash,
  signSeal,
  spokenCode,
  ulid,
  ulidTime,
  ULID_FORMAT,
  verifyMerkleProof,
  verifySealSignature,
  type UnsignedSeal,
} from './index';

const hex32 = () => randomBytes(32).toString('hex');

describe('canonicalize (RFC 8785 JCS)', () => {
  it('sorts keys by UTF-16 code units, as in the RFC 8785 §3.2.3 example', () => {
    const keys = ['€', '\r', 'דּ', '1', '😀', '\u0080', 'ö'];
    const input = Object.fromEntries(keys.map((k, i) => [k, i]));
    // Check the canonical STRING: JSON.parse + Object.keys would move "1" first (JS integer-key order).
    const out = canonicalize(input);
    const expected = ['\r', '1', '\u0080', 'ö', '€', '😀', 'דּ'];
    const positions = expected.map((k) => out.indexOf(`${JSON.stringify(k)}:`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('gives identical bytes regardless of key order, and drops undefined', () => {
    expect(canonicalize({ b: 1, a: [true, null, 'x'], c: undefined })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(canonicalize({ a: [true, null, 'x'], b: 1 })).toBe(canonicalize({ b: 1, a: [true, null, 'x'] }));
  });

  it('escapes strings like JSON', () => {
    expect(canonicalize({ s: 'a"b\n' })).toBe('{"s":"a\\"b\\n"}');
  });

  it.each([[1.5], [Number.NaN], [2 ** 60], [new Date()], [() => 1], [10n]])('rejects %s', (v) => {
    expect(() => canonicalize({ v })).toThrow();
  });
});

describe('ulid', () => {
  it('is 26 chars, sortable, and encodes its time', () => {
    const t = Date.parse('2026-11-19T12:00:00Z');
    const id = ulid(t);
    expect(id).toMatch(ULID_FORMAT);
    expect(ulidTime(id)).toBe(t);
    expect(ulid(t + 1) > ulid(t)).toBe(true);
  });

  it('never repeats', () => {
    const ids = new Set(Array.from({ length: 5_000 }, () => ulid()));
    expect(ids.size).toBe(5_000);
  });
});

describe('call code', () => {
  it('is 4 digits, deterministic per seal and secret', () => {
    const id = ulid();
    expect(callCode('s3cret', id)).toMatch(/^\d{4}$/);
    expect(callCode('s3cret', id)).toBe(callCode('s3cret', id));
  });

  it('depends on the secret', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `seal-${i}`);
    const differing = ids.filter((id) => callCode('a', id) !== callCode('b', id));
    expect(differing.length).toBeGreaterThan(45);
  });

  it.each(['0000', '7777', '1234', '6789', '9876', '3210', '1212', '4747', '1122'])(
    'treats %s as weak',
    (c) => {
      expect(isWeakCode(c)).toBe(true);
    },
  );

  it.each(['4721', '0583', '9104'])('treats %s as fine', (c) => {
    expect(isWeakCode(c)).toBe(false);
  });

  it('never produces a weak code, and spreads over all digits (20,000 seals)', () => {
    const firstDigits = new Set<string>();
    for (let i = 0; i < 20_000; i++) {
      const code = callCode('pepper', `seal-${i}`);
      expect(isWeakCode(code)).toBe(false);
      firstDigits.add(code[0] as string);
    }
    expect(firstDigits.size).toBe(10);
  });

  it('formats for screens and for the AI voice', () => {
    expect(formatCode('4721')).toBe('47-21');
    expect(spokenCode('4721')).toBe('four-seven, two-one');
    expect(spokenCode('0583')).toBe('zero-five, eight-three');
  });
});

describe('phone numbers', () => {
  it.each([
    ['+91 93361 24858', '+919336124858'],
    ['+91-933-612-4858', '+919336124858'],
    ['+31 (20) 123 4567', '+31201234567'],
  ])('normalizes %s', (raw, e164) => {
    expect(normalizeE164(raw)).toBe(e164);
  });

  it.each(['09336124858', '+0123456789', '+1', 'call me'])('rejects %s', (raw) => {
    expect(normalizeE164(raw)).toBeUndefined();
  });

  it('hashes with a secret pepper, never revealing the number', () => {
    const h = phoneHash('pepper-a', '+919336124858');
    expect(h).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    expect(h).not.toContain('9336124858');
    expect(phoneHash('pepper-a', '+919336124858')).toBe(h);
    expect(phoneHash('pepper-b', '+919336124858')).not.toBe(h);
    expect(() => phoneHash('p', '9336124858')).toThrow();
  });
});

describe('Merkle tree', () => {
  it.each(Array.from({ length: 33 }, (_, i) => i + 1))('proves every item for a tree of %i', (n) => {
    const items = Array.from({ length: n }, hex32);
    const { root, proofs } = buildMerkleTree(items);
    items.forEach((item, i) => expect(verifyMerkleProof(item, proofs[i] ?? [], root)).toBe(true));
  });

  it('rejects a wrong item, a wrong root, or a tampered proof', () => {
    const items = Array.from({ length: 6 }, hex32);
    const { root, proofs } = buildMerkleTree(items);
    const proof = proofs[2] ?? [];
    expect(verifyMerkleProof(hex32(), proof, root)).toBe(false);
    expect(verifyMerkleProof(items[2] as string, proof, hex32())).toBe(false);
    expect(verifyMerkleProof(items[2] as string, [hex32(), ...proof.slice(1)], root)).toBe(false);
    expect(verifyMerkleProof(items[2] as string, proof.slice(1), root)).toBe(false);
  });

  it('an internal node can never be passed off as an item (domain separation)', () => {
    const items = Array.from({ length: 4 }, hex32);
    const { root, proofs } = buildMerkleTree(items);
    // The node above items 0+1 is the second element of item 2's proof.
    const internal = (proofs[2] ?? [])[1] as string;
    expect(verifyMerkleProof(internal, [], root)).toBe(false);
  });

  it('the root of one item is not the item itself', () => {
    const item = hex32();
    expect(buildMerkleTree([item]).root).not.toBe(item);
  });

  it('builds the 39-byte on-chain payload and reads it back', () => {
    const root = hex32();
    const payload = anchorPayload(root);
    expect(payload.length).toBe(39);
    expect(Buffer.from(payload.subarray(0, 7)).toString('ascii')).toBe('CACHET1');
    expect(parseAnchorPayload(payload)).toBe(root);
    expect(parseAnchorPayload(payload.subarray(1))).toBeUndefined();
  });
});

describe('seal signing (Ed25519)', () => {
  const key = loadSealSigningKey('11'.repeat(32));
  const unsigned: UnsignedSeal = {
    v: 'cachet/1',
    id: ulid(),
    network: 'ccd:4221332d34e1694168c2a0c0b3fd0f27',
    kid: key.kid,
    company: { legalName: 'Northwind Energy BV', legalCountry: 'NL', account: '3tCv', proofTx: 'f2b1' },
    agent: {
      badge: 'ccd:4221332d34e1694168c2a0c0b3fd0f27/cis-2:JyP9UD2cnf5bw2YzH1GTX',
      tokenId: '1297',
      account: '33Rc',
      requestDigest: 'ab'.repeat(32),
      sig: { '0': { '0': 'cd'.repeat(64) } },
    },
    callee: { phoneHash: `hmac-sha256:${'ef'.repeat(32)}` },
    from: '+31201234567',
    purpose: 'billing',
    message: 'Your November bill is ready',
    amount: { value: '12.40', asset: 'EUDemo' },
    code: '4721',
    issuedAt: 1_795_000_000,
    expiresAt: 1_795_000_900,
    consent: 'none_recorded',
    payment: { method: 'x402-credit', ref: 'aa'.repeat(32) },
  };

  it('signs and verifies offline with the published public key', () => {
    const seal = signSeal(unsigned, key);
    const jwk = publicJwk(key);
    expect(jwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519', kid: key.kid, alg: 'EdDSA' });
    expect(verifySealSignature(seal, publicKeyFromJwk(jwk))).toBe(true);
  });

  it('is independent of key order (JCS)', () => {
    const seal = signSeal(unsigned, key);
    const reverseKeys = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reverseKeys)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.entries(v)
                .reverse()
                .map(([k, x]) => [k, reverseKeys(x)]),
            )
          : v;
    const reordered = reverseKeys(seal) as typeof seal;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(seal));
    expect(verifySealSignature(reordered, key.publicKey)).toBe(true);
  });

  it('fails if anything is changed', () => {
    const seal = signSeal(unsigned, key);
    expect(verifySealSignature({ ...seal, code: '4722' }, key.publicKey)).toBe(false);
    expect(
      verifySealSignature({ ...seal, company: { ...seal.company, legalName: 'Scam BV' } }, key.publicKey),
    ).toBe(false);
    expect(verifySealSignature({ ...seal, cachetSig: 'AAAA' }, key.publicKey)).toBe(false);
  });

  it('fails with another key', () => {
    const seal = signSeal(unsigned, key);
    const other = generateKeyPairSync('ed25519').publicKey;
    expect(verifySealSignature(seal, other)).toBe(false);
    expect(keyId(other)).not.toBe(key.kid);
  });

  it('refuses to sign a seal whose kid belongs to a different key', () => {
    expect(() => signSeal({ ...unsigned, kid: 'cachet-0000000000000000' }, key)).toThrow();
  });

  it('seal hash is stable and changes with content', () => {
    const seal = signSeal(unsigned, key);
    expect(sealHash(seal)).toMatch(/^[0-9a-f]{64}$/);
    expect(sealHash(seal)).toBe(sealHash(JSON.parse(JSON.stringify(seal)) as typeof seal));
    expect(sealHash({ ...seal, message: 'x' })).not.toBe(sealHash(seal));
  });

  it('rejects a malformed seed', () => {
    expect(() => loadSealSigningKey('abc')).toThrow();
  });
});
