import { checkPayment, decimalToRaw, normalizeAccountAddress, type OnChainAgent } from '@cachet/concordium';
import { canonicalize, sha256Hex, type Seal } from '@cachet/shared/seal';
import type { AgentRepo } from '../agents/repo';
import type { BusinessRepo } from '../business/repo';
import type { KvStore } from '../infra/kv';
import type { SealRepo } from '../seals/repo';
import { SEAL_CHANNEL } from '../seals/service';
import type { PaymentsRepo } from './repo';

export type PayErrorCode =
  | 'seal_not_found'
  | 'pay_not_requested'
  | 'pay_closed'
  | 'pay_already_paid'
  | 'pay_in_progress'
  | 'pay_invalid_account'
  | 'pay_account_not_found'
  | 'pay_insufficient_funds'
  | 'pay_too_many_attempts'
  | 'pay_unavailable'
  | 'pay_pending'
  | 'pay_failed'
  | 'pay_mismatch';

export class PayError extends Error {
  constructor(
    readonly code: PayErrorCode,
    readonly detail?: string,
  ) {
    super(code);
    this.name = 'PayError';
  }
}

/** The chain operations the pay service needs (real: @cachet/concordium payments helpers). */
export interface PayChain {
  balanceRaw(account: string, tokenId: string): Promise<bigint | null>;
  buildSponsoredTransfer(input: {
    sender: string;
    recipient: string;
    tokenId: string;
    decimals: number;
    amount: string;
    memo: string;
  }): Promise<{ json: string; expiresAt: Date }>;
  /** Finalized summary as plain JSON, or null if not finalized within the wait. */
  finalizedSummary(txHash: string): Promise<Record<string, unknown> | null>;
}

export interface PayServiceDeps {
  seals: Pick<SealRepo, 'get'>;
  agents: Pick<AgentRepo, 'findById'>;
  businesses: Pick<BusinessRepo, 'findById'>;
  /** A FRESH on-chain read (no cache): the recipient must be the agentWallet right now. */
  readAgent: (tokenId: bigint) => Promise<OnChainAgent | null>;
  payments: PaymentsRepo;
  kv: KvStore;
  chain: PayChain;
  pltTokenId: string;
  decimals: number;
  /** Max payment preparations per seal per hour (each one is a fee Cachet may have to pay). */
  maxAttempts?: number;
  now?: () => number;
}

export const paymentMemo = (sealId: string) => `cachet:${sealId}`;

/**
 * Safe payment (plan §13.2). The amount and asset come from the seal; the recipient is the AI caller's
 * agentWallet read live from the Concordium Agent Registry; the memo ties the transfer to the seal.
 * Nothing the caller says on the phone can change any of these. Cachet's sponsor pays the fee.
 */
export function createPayService(deps: PayServiceDeps) {
  const now = deps.now ?? Date.now;
  const maxAttempts = deps.maxAttempts ?? 5;

  async function sealFor(sealId: string, calleeHash: string) {
    const row = await deps.seals.get(sealId);
    // Someone else's seal looks exactly like a missing one.
    if (!row || row.phoneHash !== calleeHash) throw new PayError('seal_not_found');
    const seal = JSON.parse(row.sealJson) as Seal;
    if (!seal.amount) throw new PayError('pay_not_requested');
    return { row, seal, amount: seal.amount };
  }

  /** The live agentWallet, only while the AI caller is switched on and still owned by the company. */
  async function liveRecipient(agentId: string, companyAccount: string): Promise<string> {
    const agent = await deps.agents.findById(agentId);
    if (!agent || agent.tokenId === null) throw new PayError('pay_closed', 'agent unknown');
    let live: OnChainAgent | null;
    try {
      live = await deps.readAgent(agent.tokenId);
    } catch (err) {
      throw new PayError('pay_unavailable', err instanceof Error ? err.message : String(err));
    }
    if (!live || live.status !== 'Active' || live.owner !== companyAccount) {
      throw new PayError('pay_closed', 'agent not active on chain');
    }
    if (!live.agentWallet) throw new PayError('pay_closed', 'no agentWallet on chain');
    return live.agentWallet;
  }

  return {
    /** Build the sponsored transfer for the person's wallet to approve. */
    async prepare(sealId: string, calleeHash: string, senderInput: string) {
      const { row, seal, amount } = await sealFor(sealId, calleeHash);
      if (await deps.payments.forSeal(sealId)) throw new PayError('pay_already_paid');
      if (row.status !== 'open' || row.expiresAt.getTime() <= now())
        throw new PayError('pay_closed', 'seal ended');
      if (amount.asset !== deps.pltTokenId) throw new PayError('pay_closed', 'asset changed');
      const business = await deps.businesses.findById(row.businessId);
      if (!business || business.status !== 'active') throw new PayError('pay_closed', 'company suspended');

      const sender = normalizeAccountAddress(senderInput);
      if (!sender) throw new PayError('pay_invalid_account');
      const recipient = await liveRecipient(row.agentId, seal.company.account);
      if (sender === recipient) throw new PayError('pay_invalid_account', 'sender is the recipient');

      // One payment in flight per seal: a second wallet could otherwise pay the same bill twice.
      // (The same wallet may retry: both transfers share its nonce, so at most one can execute.)
      const pending = await deps.kv.get(`pay:expect:${sealId}`);
      if (pending) {
        const p = JSON.parse(pending) as { sender: string; expiresAt?: string };
        if (p.sender !== sender && p.expiresAt && Date.parse(p.expiresAt) > now()) {
          throw new PayError('pay_in_progress');
        }
      }
      // Every prepared transfer is a fee Cachet may pay, even if it fails on chain: limit them.
      if ((await deps.kv.incr(`pay:attempts:${sealId}`, 3600)) > maxAttempts) {
        throw new PayError('pay_too_many_attempts');
      }
      const amountRaw = decimalToRaw(amount.value, deps.decimals);
      const balance = await deps.chain.balanceRaw(sender, deps.pltTokenId);
      if (balance === null) throw new PayError('pay_account_not_found');
      if (balance < amountRaw) throw new PayError('pay_insufficient_funds');

      const built = await deps.chain.buildSponsoredTransfer({
        sender,
        recipient,
        tokenId: deps.pltTokenId,
        decimals: deps.decimals,
        amount: amount.value,
        memo: paymentMemo(sealId),
      });
      // Confirm checks against exactly what we built (even if the agentWallet changes meanwhile).
      await deps.kv.set(
        `pay:expect:${sealId}`,
        JSON.stringify({ recipient, sender, expiresAt: built.expiresAt.toISOString() }),
        3600,
      );
      return {
        transaction: built.json,
        expiresAt: built.expiresAt.toISOString(),
        amount,
        company: seal.company.legalName,
        recipient,
        sender,
      };
    },

    /** The wallet sent the transaction: check it on chain, then record the payment (once). */
    async confirm(sealId: string, calleeHash: string, txHash: string) {
      const { row, seal, amount } = await sealFor(sealId, calleeHash);
      const hash = txHash.toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(hash)) throw new PayError('pay_mismatch', 'bad hash');
      const existing = await deps.payments.forSeal(sealId);
      if (existing) {
        if (existing.txHash === hash)
          return { status: 'paid' as const, txHash: hash, paidAt: existing.paidAt };
        throw new PayError('pay_already_paid');
      }
      const expectRaw = await deps.kv.get(`pay:expect:${sealId}`);
      const recipient = expectRaw
        ? (JSON.parse(expectRaw) as { recipient: string }).recipient
        : await liveRecipient(row.agentId, seal.company.account);

      let summary: Record<string, unknown> | null;
      try {
        summary = await deps.chain.finalizedSummary(hash);
      } catch (err) {
        throw new PayError('pay_unavailable', err instanceof Error ? err.message : String(err));
      }
      if (!summary) throw new PayError('pay_pending');
      const check = checkPayment(summary, {
        tokenId: deps.pltTokenId,
        recipient,
        amountRaw: decimalToRaw(amount.value, deps.decimals),
        decimals: deps.decimals,
        memo: paymentMemo(sealId),
      });
      if (!check.ok)
        throw new PayError(check.reason === 'failed' ? 'pay_failed' : 'pay_mismatch', check.reason);

      const paidAt = new Date(now());
      const item = {
        v: 'cachet-payment/1',
        sealId,
        txHash: hash,
        amount: amount.value,
        asset: amount.asset,
        recipient,
        at: paidAt.toISOString(),
      };
      const { row: payment, created } = await deps.payments.record(
        {
          sealId,
          businessId: row.businessId,
          txHash: hash,
          payer: check.payer,
          recipient,
          amount: amount.value,
          asset: amount.asset,
          sponsored: check.sponsor !== null,
          paidAt,
        },
        sha256Hex(canonicalize(item)),
      );
      if (created) {
        deps.kv
          .publish(
            SEAL_CHANNEL,
            JSON.stringify({ type: 'seal.paid', sealId, phoneHash: row.phoneHash, txHash: hash }),
          )
          .catch((err: unknown) => console.error('[pay] publish failed', err));
      }
      return { status: 'paid' as const, txHash: payment.txHash, paidAt: payment.paidAt };
    },
  };
}

export type PayService = ReturnType<typeof createPayService>;
