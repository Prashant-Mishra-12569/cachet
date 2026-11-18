import { createHash, randomBytes } from 'node:crypto';
import type { AccountTransactionSignature } from '@concordium/web-sdk';
import { normalizeAccountAddress, type MessageCheck } from '@cachet/concordium';
import type { Network } from '@cachet/shared';
import type { KvStore } from '../infra/kv';

export type AuthErrorCode =
  'invalid_account' | 'challenge_expired' | 'challenge_mismatch' | 'account_not_found' | 'bad_signature';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = 'AuthError';
  }
}

export type VerifyMessage = (
  address: string,
  message: string,
  signature: AccountTransactionSignature,
) => Promise<MessageCheck>;

export interface AuthServiceOptions {
  kv: KvStore;
  verifyMessage: VerifyMessage;
  network: Network;
  /** The website people sign in on; written into the message so they can see where it came from. */
  webOrigin: string;
  challengeTtlSeconds?: number;
  sessionTtlSeconds?: number;
  now?: () => number;
}

export interface Challenge {
  challengeId: string;
  message: string;
  expiresAt: string;
}

export interface Session {
  account: string;
  createdAt: string;
  expiresAt: string;
}

interface StoredChallenge {
  address: string;
  message: string;
  expiresAt: number;
}

const CHALLENGE_PREFIX = 'auth:challenge:';
const SESSION_PREFIX = 'auth:session:';
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url
const CHALLENGE_ID_FORMAT = /^[A-Za-z0-9_-]{22}$/; // 16 random bytes, base64url

/** Sessions are stored under a hash of the token, so a leaked store can't be used to log in. */
const sessionKey = (token: string) => SESSION_PREFIX + createHash('sha256').update(token).digest('hex');

export function createAuthService(options: AuthServiceOptions) {
  const now = options.now ?? Date.now;
  const challengeTtl = options.challengeTtlSeconds ?? 5 * 60;
  const sessionTtl = options.sessionTtlSeconds ?? 8 * 60 * 60;

  async function createChallenge(rawAddress: string): Promise<Challenge> {
    const address = normalizeAccountAddress(rawAddress);
    if (!address) throw new AuthError('invalid_account');

    const challengeId = randomBytes(16).toString('base64url');
    const issuedAt = now();
    const expiresAt = issuedAt + challengeTtl * 1000;
    const message = [
      'Sign in to Cachet',
      '',
      'This only proves you own this account.',
      'It is not a transaction and costs nothing.',
      '',
      `Account: ${address}`,
      `Website: ${options.webOrigin}`,
      `Network: Concordium ${options.network}`,
      `Nonce: ${randomBytes(16).toString('hex')}`,
      `Issued: ${new Date(issuedAt).toISOString()}`,
      `Expires: ${new Date(expiresAt).toISOString()}`,
    ].join('\n');

    const stored: StoredChallenge = { address, message, expiresAt };
    await options.kv.set(CHALLENGE_PREFIX + challengeId, JSON.stringify(stored), challengeTtl);
    return { challengeId, message, expiresAt: new Date(expiresAt).toISOString() };
  }

  async function verifyChallenge(input: {
    challengeId: string;
    address: string;
    signature: AccountTransactionSignature;
  }): Promise<{ token: string; session: Session }> {
    const address = normalizeAccountAddress(input.address);
    if (!address) throw new AuthError('invalid_account');
    if (!CHALLENGE_ID_FORMAT.test(input.challengeId)) throw new AuthError('challenge_expired');

    // Single use: the challenge is deleted as it is read, even if the signature turns out wrong.
    const raw = await options.kv.take(CHALLENGE_PREFIX + input.challengeId);
    if (!raw) throw new AuthError('challenge_expired');
    const challenge = JSON.parse(raw) as StoredChallenge;
    if (challenge.expiresAt <= now()) throw new AuthError('challenge_expired');
    if (challenge.address !== address) throw new AuthError('challenge_mismatch');

    const check = await options.verifyMessage(address, challenge.message, input.signature);
    if (!check.ok) throw new AuthError(check.reason);

    const token = randomBytes(32).toString('base64url');
    const createdAt = now();
    const session: Session = {
      account: address,
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + sessionTtl * 1000).toISOString(),
    };
    await options.kv.set(sessionKey(token), JSON.stringify(session), sessionTtl);
    return { token, session };
  }

  async function getSession(token: string | undefined): Promise<Session | null> {
    if (!token || !TOKEN_FORMAT.test(token)) return null;
    const raw = await options.kv.get(sessionKey(token));
    return raw ? (JSON.parse(raw) as Session) : null;
  }

  async function endSession(token: string | undefined): Promise<void> {
    if (token && TOKEN_FORMAT.test(token)) await options.kv.del(sessionKey(token));
  }

  return { createChallenge, verifyChallenge, getSession, endSession, sessionTtlSeconds: sessionTtl };
}

export type AuthService = ReturnType<typeof createAuthService>;
