import {
  AccountAddress,
  CcdAmount,
  CredentialRegistrationId,
  type ConcordiumGRPCClient,
} from '@concordium/web-sdk';
import { TokenAmount } from '@concordium/web-sdk/plt';

export interface AccountSnapshot {
  address: string;
  /** CCD balance as a decimal string. */
  ccd: string;
  /** Nonce from account info (last finalized view). */
  accountNonce: bigint;
  /** Next nonce to use for a new transaction (includes pending transactions). */
  nextNonce: bigint;
  /** True if every known transaction from this account is finalized. */
  allFinal: boolean;
  /** PLT balances held by the account. */
  tokens: { id: string; balance: string }[];
}

export function parseAccountAddress(base58: string): AccountAddress.Type {
  try {
    return AccountAddress.fromBase58(base58.trim());
  } catch {
    throw new Error(`Not a valid Concordium account address: "${base58}"`);
  }
}

/**
 * Which account does this credential (registration id, 96 hex chars) belong to?
 * Returns null if no account on chain has it.
 */
export async function accountOfCredential(
  client: ConcordiumGRPCClient,
  credIdHex: string,
): Promise<string | null> {
  if (!/^[0-9a-f]{96}$/i.test(credIdHex)) return null;
  try {
    const info = await client.getAccountInfo(CredentialRegistrationId.fromHexString(credIdHex.toLowerCase()));
    return AccountAddress.toBase58(info.accountAddress);
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === 'NOT_FOUND') return null;
    throw err;
  }
}

/** Read balance, nonce and token balances for one account. */
export async function getAccountSnapshot(
  client: ConcordiumGRPCClient,
  base58: string,
): Promise<AccountSnapshot> {
  const address = parseAccountAddress(base58);
  const [info, next] = await Promise.all([
    client.getAccountInfo(address),
    client.getNextAccountNonce(address),
  ]);
  return {
    address: AccountAddress.toBase58(info.accountAddress),
    ccd: CcdAmount.toCcd(info.accountAmount).toFixed(),
    accountNonce: info.accountNonce.value,
    nextNonce: next.nonce.value,
    allFinal: next.allFinal,
    tokens: info.accountTokens.map((t) => ({
      id: t.id.toString(),
      balance: TokenAmount.toDecimal(t.state.balance).toFixed(),
    })),
  };
}
