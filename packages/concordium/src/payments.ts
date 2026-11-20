import {
  AccountAddress,
  TransactionExpiry,
  TransactionHash,
  type AccountSigner,
  type ConcordiumGRPCClient,
} from '@concordium/web-sdk';
import {
  CborAccountAddress,
  CborMemo,
  TokenAmount,
  TokenId,
  createTokenUpdatePayload,
} from '@concordium/web-sdk/plt';
import { Transaction } from '@concordium/web-sdk/transactions';

/**
 * Sponsored PLT payments (plan §13.2): the person pays the token amount, Cachet's sponsor pays the
 * transaction fee, so the person needs no CCD. Verified live on testnet 20 Nov
 * (tx 43d6b6ea8c298ff9dcb1df43e012cf4221225396e6099ba9443ad304ea5a615a).
 */

/** "12.40" with 6 decimals → 12400000n. Refuses more decimals than the token has. */
export function decimalToRaw(value: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m || (m[2]?.length ?? 0) > decimals) throw new Error(`not a valid amount: ${value}`);
  return BigInt(`${m[1] ?? '0'}${(m[2] ?? '').padEnd(decimals, '0')}`);
}

/**
 * The memo as it appears in a TokenTransfer event: hex of the CBOR-encoded text (the memo's own JSON
 * form; NOT CborMemo.toCBOR, which wraps it in an extra tagged byte string).
 */
export function memoHex(text: string): string {
  return CborMemo.fromString(text).toJSON().toLowerCase();
}

/** JSON for the wallet, as in Concordium's sponsor tutorial: bigint → number when safe, else string. */
export function toWireJson(value: unknown): string {
  return JSON.stringify(value, (_k, x: unknown) =>
    typeof x === 'bigint' ? (x <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(x) : x.toString()) : x,
  );
}

/** Plain JSON copy of an SDK object (bigint → string), e.g. a transaction summary. */
export function toPlainJson(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x)),
  ) as unknown;
}

/** An account's balance of a token, in raw units. Null if the account doesn't exist. */
export async function tokenBalanceRaw(
  client: ConcordiumGRPCClient,
  account: string,
  tokenId: string,
): Promise<bigint | null> {
  let info;
  try {
    info = await client.getAccountInfo(AccountAddress.fromBase58(account));
  } catch {
    return null;
  }
  const held = info.accountTokens.find((t) => t.id.toString() === tokenId);
  if (!held) return 0n;
  return BigInt((held.state.balance.toJSON() as TokenAmount.JSON).value);
}

export interface SponsoredTransferInput {
  client: ConcordiumGRPCClient;
  sponsor: { address: string; signer: AccountSigner };
  sender: string;
  recipient: string;
  tokenId: string;
  decimals: number;
  /** Decimal string, e.g. "12.40". */
  amount: string;
  memo: string;
  /** How long the sponsor's signature is valid. Plan: 5 minutes. */
  expiryMinutes?: number;
}

/**
 * Build the exact transfer (amount, recipient, memo fixed by us), signed by the sponsor as fee payer.
 * Returns the JSON the person's wallet co-signs (Transaction.signableFromJSON on the other side).
 */
export async function buildSponsoredTransfer(input: SponsoredTransferInput) {
  const sender = AccountAddress.fromBase58(input.sender);
  const payload = createTokenUpdatePayload(TokenId.fromString(input.tokenId), {
    transfer: {
      amount: TokenAmount.create(decimalToRaw(input.amount, input.decimals), input.decimals),
      recipient: CborAccountAddress.fromAccountAddress(AccountAddress.fromBase58(input.recipient)),
      memo: CborMemo.fromString(input.memo),
    },
  });
  const nonce = await input.client.getNextAccountNonce(sender);
  const expiry = TransactionExpiry.futureMinutes(input.expiryMinutes ?? 5);
  const signable = Transaction.tokenUpdate(payload)
    .addMetadata({ sender, nonce: nonce.nonce, expiry })
    .addSponsor(AccountAddress.fromBase58(input.sponsor.address))
    .build();
  const sponsored = await Transaction.sponsor(signable, input.sponsor.signer);
  return { json: toWireJson(Transaction.toJSON(sponsored)), expiresAt: TransactionExpiry.toDate(expiry) };
}

/** Wait for a transaction to be finalized; returns its summary as plain JSON, or null on timeout. */
export async function finalizedSummary(
  client: ConcordiumGRPCClient,
  txHash: string,
  timeoutMs = 60_000,
): Promise<Record<string, unknown> | null> {
  const hash = TransactionHash.fromHexString(txHash);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const outcome = await Promise.race([client.waitForTransactionFinalization(hash), timeout]);
    return outcome ? (toPlainJson(outcome.summary) as Record<string, unknown>) : null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ExpectedPayment {
  tokenId: string;
  recipient: string;
  /** Raw units (see decimalToRaw). */
  amountRaw: bigint;
  decimals: number;
  memo: string;
}

export type PaymentCheck =
  | { ok: true; payer: string; sponsor: string | null }
  | { ok: false; reason: 'not_account_transaction' | 'failed' | 'not_token_update' | 'no_matching_transfer' };

/**
 * Does this finalized transaction (summary as plain JSON) pay exactly what we expect: the token,
 * the amount, to the recipient, with our memo? Pure; works on the JSON shape the node returns.
 */
export function checkPayment(summary: Record<string, unknown>, expected: ExpectedPayment): PaymentCheck {
  if (summary['type'] !== 'accountTransaction') return { ok: false, reason: 'not_account_transaction' };
  if (summary['transactionType'] === 'failed') return { ok: false, reason: 'failed' };
  if (summary['transactionType'] !== 'tokenUpdate') return { ok: false, reason: 'not_token_update' };
  const memo = memoHex(expected.memo);
  const events = Array.isArray(summary['events']) ? (summary['events'] as Record<string, unknown>[]) : [];
  const match = events.find((e) => {
    const to = e['to'] as { type?: string; address?: string } | null;
    const amount = e['amount'] as { value?: string; decimals?: number } | null;
    return (
      e['tag'] === 'TokenTransfer' &&
      e['tokenId'] === expected.tokenId &&
      to?.type === 'account' &&
      to.address === expected.recipient &&
      amount?.decimals === expected.decimals &&
      amount.value === expected.amountRaw.toString() &&
      typeof e['memo'] === 'string' &&
      e['memo'].toLowerCase() === memo
    );
  });
  if (!match) return { ok: false, reason: 'no_matching_transfer' };
  const sponsor = summary['sponsor'] as { sponsor?: string } | undefined;
  return { ok: true, payer: String(summary['sender']), sponsor: sponsor?.sponsor ?? null };
}
