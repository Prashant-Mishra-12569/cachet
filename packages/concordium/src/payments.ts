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
  Token,
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

/**
 * Would this transfer be accepted by the token's own rules (allow list, deny list, paused, balance)?
 * Checked before the sponsor signs: a sponsored transfer that fails on chain still costs its fee.
 */
export async function transferCheck(
  client: ConcordiumGRPCClient,
  input: { sender: string; recipient: string; tokenId: string; amount: string; decimals: number },
): Promise<'ok' | 'not_allowed' | 'paused' | 'insufficient_funds'> {
  const token = await Token.fromId(client, TokenId.fromString(input.tokenId));
  try {
    await Token.validateTransfer(token, AccountAddress.fromBase58(input.sender), {
      amount: TokenAmount.create(decimalToRaw(input.amount, input.decimals), input.decimals),
      recipient: CborAccountAddress.fromAccountAddress(AccountAddress.fromBase58(input.recipient)),
    });
    return 'ok';
  } catch (err) {
    if (err instanceof Token.NotAllowedError) return 'not_allowed';
    if (err instanceof Token.PausedError) return 'paused';
    if (err instanceof Token.InsufficientFundsError) return 'insufficient_funds';
    throw err;
  }
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

/** Retry a node call when the (public) node says "too many requests" or is briefly unavailable. */
export async function withRetry<T>(call: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await call();
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      if (i >= attempts || !/429|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(text)) throw err;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i)); // 0.8 s, 1.6 s, 3.2 s
    }
  }
}

/** Does this finalized transaction (by hash) pay exactly this? Null if not found/finalized yet. */
export async function transferMatches(
  client: ConcordiumGRPCClient,
  txHash: string,
  s: Omit<TransferSearch, 'since' | 'maxBlocks'>,
): Promise<boolean | null> {
  let status;
  try {
    status = await withRetry(() => client.getBlockItemStatus(TransactionHash.fromHexString(txHash)));
  } catch {
    return null; // unknown to the node (yet)
  }
  if (status.status !== 'finalized') return null;
  const summary = toPlainJson(status.outcome.summary) as Record<string, unknown>;
  return (
    summary['sender'] === s.sender &&
    checkPayment(summary, {
      tokenId: s.tokenId,
      recipient: s.recipient,
      amountRaw: s.amountRaw,
      decimals: s.decimals,
      memo: null,
    }).ok
  );
}

export interface TransferSearch {
  sender: string;
  recipient: string;
  tokenId: string;
  amountRaw: bigint;
  decimals: number;
  /** Only look at blocks made at or after this time. */
  since: Date;
  /** Safety limit on blocks scanned (testnet makes a block every few seconds). */
  maxBlocks?: number;
}

/**
 * Finalized token transfers that match EXACTLY (sender, recipient, token, amount), newest first.
 * Used when a facilitator reports a settlement as failed: settlement can succeed on chain even when
 * the facilitator's answer says otherwise, so the chain is the source of truth.
 */
export async function findTokenTransfers(client: ConcordiumGRPCClient, s: TransferSearch): Promise<string[]> {
  const found: string[] = [];
  const BATCH = 4n; // blocks read in parallel (the public node answers 429 to bigger bursts)
  const maxBlocks = BigInt(s.maxBlocks ?? 300);
  const top = (await client.getConsensusStatus()).lastFinalizedBlockHeight;
  const bottom = top - maxBlocks + 1n > 0n ? top - maxBlocks + 1n : 0n;

  async function scan(height: bigint): Promise<'older' | 'ok'> {
    const [hash] = await withRetry(() => client.getBlocksAtHeight(height));
    if (!hash) return 'ok';
    const info = await withRetry(() => client.getBlockInfo(hash));
    if (info.blockSlotTime < s.since) return 'older';
    if (info.transactionCount === 0n) return 'ok';
    const items = await withRetry(async () => {
      const list: unknown[] = [];
      for await (const item of client.getBlockTransactionEvents(hash)) list.push(item);
      return list;
    });
    for (const item of items) {
      const summary = toPlainJson(item) as Record<string, unknown>;
      if (summary['type'] !== 'accountTransaction' || summary['sender'] !== s.sender) continue;
      const check = checkPayment(summary, {
        tokenId: s.tokenId,
        recipient: s.recipient,
        amountRaw: s.amountRaw,
        decimals: s.decimals,
        memo: null,
      });
      if (check.ok && typeof summary['hash'] === 'string') found.push(summary['hash']);
    }
    return 'ok';
  }

  for (let high = top; high >= bottom; high -= BATCH) {
    const heights: bigint[] = [];
    for (let h = high; h > high - BATCH && h >= bottom; h--) heights.push(h);
    const results = await Promise.all(heights.map(scan));
    if (results.includes('older')) break; // reached blocks made before `since`
  }
  return found;
}

export interface ExpectedPayment {
  tokenId: string;
  recipient: string;
  /** Raw units (see decimalToRaw). */
  amountRaw: bigint;
  decimals: number;
  /** Required memo text; null = no memo check (x402 transfers carry no memo). */
  memo: string | null;
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
  const memo = expected.memo === null ? null : memoHex(expected.memo);
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
      (memo === null || (typeof e['memo'] === 'string' && e['memo'].toLowerCase() === memo))
    );
  });
  if (!match) return { ok: false, reason: 'no_matching_transfer' };
  const sponsor = summary['sponsor'] as { sponsor?: string } | undefined;
  return { ok: true, payer: String(summary['sender']), sponsor: sponsor?.sponsor ?? null };
}
