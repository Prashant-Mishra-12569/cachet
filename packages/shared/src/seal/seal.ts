import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { canonicalize } from './jcs';

/**
 * A Cachet seal: Cachet's signed statement that a verified company's registered AI caller is calling
 * a specific person (identified only by a phone hash), for a stated reason, in a short time window.
 * Canonical form: RFC 8785 JCS. Signature: Ed25519 over JCS(seal without `cachetSig`).
 */
export interface Seal {
  v: 'cachet/1';
  /** ULID */
  id: string;
  /** CAIP-2 chain id, e.g. "ccd:4221332d34e1694168c2a0c0b3fd0f27" */
  network: string;
  /** Which Cachet key signed this seal (see /.well-known/cachet-keys.json). */
  kid: string;
  company: {
    legalName: string;
    legalCountry: string;
    account: string;
    /** On-chain audit anchor of the company's zero-knowledge proof. */
    proofTx: string;
  };
  agent: {
    /** CAIP-19 badge, e.g. "ccd:4221…/cis-2:JyP9UD2cnf5bw2YzH1GTX" */
    badge: string;
    tokenId: string;
    /** The AI's own Concordium account. */
    account: string;
    /** sha256(JCS(seal request)), hex — what the AI signed. */
    requestDigest: string;
    /** The AI's account signature over SEAL_REQUEST_MESSAGE(requestDigest) (credential → key → hex sig). */
    sig: Record<string, Record<string, string>>;
  };
  callee: { phoneHash: string };
  /** Number the AI says it calls from (informational: caller ID can be spoofed). */
  from: string;
  purpose: string;
  /** Shown to the person, ≤ 80 chars. */
  message: string;
  amount?: { value: string; asset: string };
  /** 4 digits, e.g. "4721" (shown as 47-21). */
  code: string;
  /** Unix seconds. */
  issuedAt: number;
  expiresAt: number;
  /** We never imply consent we don't have. */
  consent: 'none_recorded' | 'granted';
  payment: { method: 'x402-credit'; ref: string };
  /** Ed25519 signature, base64url. */
  cachetSig: string;
}

export type UnsignedSeal = Omit<Seal, 'cachetSig'>;

/** What the AI's Concordium account signs (with the wallet message-signing scheme) to ask for a seal. */
export const sealRequestMessage = (requestDigest: string) => `cachet:seal-request:v1:${requestDigest}`;
/** What the AI signs to close a seal when the call ends. */
export const sealCloseMessage = (closeDigest: string) => `cachet:seal-close:v1:${closeDigest}`;

export const sha256Hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/** sha256(JCS(seal)), hex: the seal's fingerprint and its Merkle leaf item. */
export const sealHash = (seal: Seal) => sha256Hex(canonicalize(seal));

// --- Ed25519 keys -----------------------------------------------------------------------------

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export interface SealSigningKey {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

/** Load the seal signing key from a 32-byte seed (64 hex chars, the SEAL_SIGNING_KEY env value). */
export function loadSealSigningKey(seedHex: string): SealSigningKey {
  if (!/^[0-9a-f]{64}$/i.test(seedHex))
    throw new Error('SEAL_SIGNING_KEY must be 64 hex characters (32-byte seed)');
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seedHex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = createPublicKey(privateKey);
  return { kid: keyId(publicKey), privateKey, publicKey };
}

const rawPublicKey = (k: KeyObject) =>
  Buffer.from((k.export({ format: 'jwk' }) as { x: string }).x, 'base64url');

/** Key id = first 16 hex chars of sha256(raw public key). */
export const keyId = (publicKey: KeyObject) => `cachet-${sha256Hex(rawPublicKey(publicKey)).slice(0, 16)}`;

/** Public key in JWK form, for /.well-known/cachet-keys.json. */
export function publicJwk(key: SealSigningKey) {
  return {
    kty: 'OKP',
    crv: 'Ed25519',
    x: rawPublicKey(key.publicKey).toString('base64url'),
    kid: key.kid,
    alg: 'EdDSA',
    use: 'sig',
  };
}

export function publicKeyFromJwk(jwk: { kty: string; crv: string; x: string }): KeyObject {
  return createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, format: 'jwk' });
}

// --- sign / verify ----------------------------------------------------------------------------

export function signSeal(unsigned: UnsignedSeal, key: SealSigningKey): Seal {
  if (unsigned.kid !== key.kid) throw new Error('seal kid does not match the signing key');
  const sig = sign(null, Buffer.from(canonicalize(unsigned), 'utf8'), key.privateKey);
  return { ...unsigned, cachetSig: sig.toString('base64url') };
}

/** Offline check that `seal` was signed by `publicKey` and has not been changed. */
export function verifySealSignature(seal: Seal, publicKey: KeyObject): boolean {
  const { cachetSig, ...unsigned } = seal;
  try {
    return verify(
      null,
      Buffer.from(canonicalize(unsigned), 'utf8'),
      publicKey,
      Buffer.from(cachetSig, 'base64url'),
    );
  } catch {
    return false;
  }
}
