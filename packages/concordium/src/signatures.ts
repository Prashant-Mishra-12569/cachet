import {
  AccountAddress,
  verifyMessageSignature,
  type AccountTransactionSignature,
  type ConcordiumGRPCClient,
} from '@concordium/web-sdk';

export type MessageCheck = { ok: true } | { ok: false; reason: 'account_not_found' | 'bad_signature' };

const HEX = /^[0-9a-f]+$/i;

/**
 * Parse a wallet signature ({ credIndex: { keyIndex: hexSig } }) from untrusted JSON.
 * Returns undefined for anything that isn't that exact shape.
 */
export function parseAccountSignature(value: unknown): AccountTransactionSignature | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: AccountTransactionSignature = {};
  const creds = Object.entries(value as Record<string, unknown>);
  if (creds.length === 0 || creds.length > 255) return undefined;
  for (const [credIndex, keys] of creds) {
    if (!/^\d{1,3}$/.test(credIndex) || !keys || typeof keys !== 'object' || Array.isArray(keys)) {
      return undefined;
    }
    const entries = Object.entries(keys as Record<string, unknown>);
    if (entries.length === 0 || entries.length > 255) return undefined;
    const inner: Record<number, string> = {};
    for (const [keyIndex, sig] of entries) {
      // Ed25519 signatures are 64 bytes = 128 hex characters.
      if (!/^\d{1,3}$/.test(keyIndex) || typeof sig !== 'string' || sig.length !== 128 || !HEX.test(sig)) {
        return undefined;
      }
      inner[Number(keyIndex)] = sig;
    }
    out[Number(credIndex)] = inner;
  }
  return out;
}

/**
 * Check that `signature` is a valid wallet signature of `message` by `address`, using the account's
 * current on-chain keys and threshold. The wallet signs (address || 8 zero bytes || message).
 */
export async function verifyAccountMessage(
  client: ConcordiumGRPCClient,
  address: string,
  message: string,
  signature: AccountTransactionSignature,
): Promise<MessageCheck> {
  const account = AccountAddress.fromBase58(address);
  let accountInfo;
  try {
    accountInfo = await client.getAccountInfo(account);
  } catch (err) {
    // gRPC answers RpcError with code NOT_FOUND ("account or block not found.").
    if ((err as { code?: unknown } | null)?.code === 'NOT_FOUND')
      return { ok: false, reason: 'account_not_found' };
    throw err;
  }
  // A malformed signature (e.g. wrong key index) makes the SDK throw; that simply means "not valid".
  const valid = await verifyMessageSignature(message, signature, accountInfo).catch(() => false);
  return valid ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

/** Returns the checksum-validated base58 address, or undefined if invalid. */
export function normalizeAccountAddress(value: string): string | undefined {
  try {
    return AccountAddress.toBase58(AccountAddress.fromBase58(value.trim()));
  } catch {
    return undefined;
  }
}
