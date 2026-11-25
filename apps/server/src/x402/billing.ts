import { decimalToRaw, type TransferSearch } from '@cachet/concordium';
import { ExactConcordiumScheme } from '@x402/concordium/exact/server';
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http';
import { x402ResourceServer, type FacilitatorClient } from '@x402/core/server';
import type {
  Network,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
} from '@x402/core/types';
import type { AgentRecord } from '../agents/repo';
import type { SealRepo } from '../seals/repo';

/**
 * x402 seal billing (plan §13.1): every seal is prepaid. An AI caller buys seal credits with an x402
 * payment in the digital-euro PLT; the facilitator checks it, sponsors the fee and settles it on chain.
 *
 * Order matters (money safety):
 *  1. verify the payment (facilitator: 9 rules, incl. the payer's signature),
 *  2. the payer must be a registered, ACTIVE AI caller (before anything is settled: a stranger must
 *     never make us pay settlement fees, and nobody pays for credits that can't be credited),
 *  3. settle (finalized on chain),
 *  4. only then add the credits (the transaction can be counted once).
 */

export const CREDIT_PACKS = [1, 10, 100, 1000] as const;
export type CreditPack = (typeof CREDIT_PACKS)[number];

export type BillingErrorCode =
  | 'x402_invalid'
  | 'x402_unknown_payer'
  | 'x402_wrong_payer'
  | 'x402_ambiguous_payer'
  | 'x402_settle_failed'
  | 'x402_unavailable';

export class BillingError extends Error {
  constructor(
    readonly code: BillingErrorCode,
    readonly detail?: string,
  ) {
    super(code);
    this.name = 'BillingError';
  }
}

export interface SealBillingDeps {
  facilitator: FacilitatorClient;
  /** CAIP-2 network, e.g. ccd:4221332d34e1694168c2a0c0b3fd0f27. */
  network: Network;
  /** Cachet's treasury account: where seal fees go. */
  payTo: string;
  /** PLT token id (EUDemo on testnet) and its decimals. */
  asset: string;
  decimals: number;
  /** Price of ONE seal as a decimal string, e.g. "0.01". */
  sealPrice: string;
  agents: { listActive(): Promise<AgentRecord[]> };
  seals: Pick<SealRepo, 'addCredits' | 'creditBalance'>;
  /** Finalized matching transfers on chain (see findTokenTransfers): the safety net for "failed" settles. */
  findTransfers?: (search: TransferSearch) => Promise<string[]>;
  /** Is this finalized tx exactly this transfer? (null = not finalized/known yet). */
  confirmTransfer?: (
    txHash: string,
    search: Omit<TransferSearch, 'since' | 'maxBlocks'>,
  ) => Promise<boolean | null>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface Purchase {
  agentId: string;
  credits: number;
  txHash: string;
  /** Header value for the client (PAYMENT-RESPONSE). */
  responseHeader: string;
  creditsNow: number;
}

export function createSealBilling(deps: SealBillingDeps) {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const unitRaw = decimalToRaw(deps.sealPrice, deps.decimals);
  if (unitRaw <= 0n) throw new Error('SEAL_PRICE must be greater than 0');
  const server = new x402ResourceServer(deps.facilitator).register(deps.network, new ExactConcordiumScheme());
  let ready: Promise<void> | null = null;

  /** Ask the facilitator what it supports (and who pays fees). Retried on the next use if it failed. */
  function init() {
    ready ??= server.initialize().catch((err: unknown) => {
      ready = null;
      throw new BillingError('x402_unavailable', err instanceof Error ? err.message : String(err));
    });
    return ready;
  }

  const priceOf = (credits: number) => {
    const raw = unitRaw * BigInt(credits);
    const whole = raw / 10n ** BigInt(deps.decimals);
    const frac = (raw % 10n ** BigInt(deps.decimals)).toString().padStart(deps.decimals, '0');
    return { raw, decimal: `${whole}.${frac.replace(/0+$/, '').padEnd(2, '0')}` };
  };

  async function requirementsFor(credits: number): Promise<PaymentRequirements[]> {
    await init();
    return server.buildPaymentRequirements({
      scheme: 'exact',
      network: deps.network,
      payTo: deps.payTo,
      price: { amount: priceOf(credits).raw.toString(), asset: deps.asset },
      // The client signs a transfer valid for up to 10 minutes (facilitator rule 7).
      maxTimeoutSeconds: 120,
    });
  }

  /** Find the active AI caller this payer is, or refuse (before any money moves). */
  async function agentFor(payer: string, badge: string | undefined): Promise<AgentRecord> {
    const mine = (await deps.agents.listActive()).filter((a) => a.agentAccount === payer);
    const agent = badge ? mine.find((a) => a.badge === badge) : mine.length === 1 ? mine[0] : undefined;
    if (!agent) {
      throw new BillingError(
        badge || mine.length === 0 ? 'x402_unknown_payer' : 'x402_ambiguous_payer',
        `payer ${payer.slice(0, 6)}… has ${mine.length} active AI caller(s)`,
      );
    }
    return agent;
  }

  return {
    priceOf,
    init,

    /** The 402 answer: what to pay for `credits` seals, and where. */
    async paymentRequired(credits: number, resourceUrl: string, description: string) {
      const requirements = await requirementsFor(credits);
      const body: PaymentRequired = await server.createPaymentRequiredResponse(requirements, {
        url: resourceUrl,
        description,
        mimeType: 'application/json',
      });
      return { body, header: encodePaymentRequiredHeader(body) };
    },

    /**
     * Settle an x402 payment for `credits` seals and credit them. `expectedAgent`: the payment must
     * come from this AI caller (the per-seal path), otherwise the payer is looked up (credit purchase).
     */
    async purchase(input: {
      header: string;
      credits: number;
      expectedAgent?: AgentRecord | undefined;
      badge?: string | undefined;
    }): Promise<Purchase> {
      let payload: PaymentPayload;
      try {
        payload = decodePaymentSignatureHeader(input.header);
      } catch {
        throw new BillingError('x402_invalid', 'payment header is not valid');
      }
      const requirements = await requirementsFor(input.credits);
      const accepted = 'accepted' in payload ? (payload.accepted as PaymentRequirements) : undefined;
      // The client must have accepted EXACTLY our terms (amount, token, recipient, network).
      const match = requirements.find(
        (r) =>
          accepted &&
          r.scheme === accepted.scheme &&
          r.network === accepted.network &&
          r.amount === accepted.amount &&
          r.asset === accepted.asset &&
          r.payTo === accepted.payTo,
      );
      if (!match) throw new BillingError('x402_invalid', 'payment terms do not match this purchase');

      const verified = await server.verifyPayment(payload, match).catch((err: unknown) => {
        throw new BillingError('x402_unavailable', err instanceof Error ? err.message : String(err));
      });
      if (!verified.isValid || !verified.payer) {
        throw new BillingError('x402_invalid', verified.invalidReason ?? 'payment rejected');
      }
      const agent = input.expectedAgent ?? (await agentFor(verified.payer, input.badge));
      if (agent.agentAccount !== verified.payer) {
        throw new BillingError('x402_wrong_payer', 'payment not from this AI caller');
      }

      const credit = (txHash: string) =>
        deps.seals.addCredits({
          agentId: agent.id,
          credits: input.credits,
          amount: priceOf(input.credits).decimal,
          asset: deps.asset,
          txHash,
        });
      const settleStarted = new Date(now() - 30_000);
      let settled: SettleResponse;
      try {
        settled = await server.settlePayment(payload, match);
      } catch (err) {
        settled = {
          success: false,
          errorReason: err instanceof Error ? err.message : String(err),
          transaction: '',
          network: deps.network,
        };
      }

      if (settled.success && settled.transaction) {
        const txHash = settled.transaction.toLowerCase();
        if (!(await credit(txHash))) console.warn(`[x402] settlement ${txHash} was already credited`);
        return done(agent.id, input.credits, txHash, settled);
      }

      // "Failed" from a facilitator does NOT always mean "not paid": the transfer can be on chain
      // anyway (seen live: hosted facilitator said "transaction not found" for a finalized transfer).
      // The chain decides. Never keep a payment without giving the credits.
      console.warn(
        `[x402] settle reported failure: ${settled.errorReason ?? '?'} (tx in answer: ${settled.transaction || 'none'})`,
      );
      const recovered = await recoverFromChain(
        verified.payer,
        BigInt(match.amount),
        settleStarted,
        credit,
        /^[0-9a-f]{64}$/i.test(settled.transaction) ? settled.transaction.toLowerCase() : null,
      );
      if (recovered) {
        console.warn(
          `[x402] facilitator reported "${settled.errorReason ?? 'failure'}" but payment ${recovered} is on chain: credited`,
        );
        return done(agent.id, input.credits, recovered, {
          success: true,
          transaction: recovered,
          network: deps.network,
          payer: verified.payer,
        });
      }
      throw new BillingError('x402_settle_failed', settled.errorReason ?? 'settlement failed');
    },
  };

  /**
   * Look on chain for exactly this transfer (payer → treasury, this token and amount) since the
   * settlement started, a few times (it may still be finalizing). Credits the first one not yet
   * credited; returns its hash, or null if nothing was paid.
   */
  async function recoverFromChain(
    payer: string,
    amountRaw: bigint,
    since: Date,
    credit: (txHash: string) => Promise<boolean>,
    hint: string | null,
  ): Promise<string | null> {
    const search = {
      sender: payer,
      recipient: deps.payTo,
      tokenId: deps.asset,
      amountRaw,
      decimals: deps.decimals,
    };
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await sleep(5_000);
      // 1) The facilitator told us the hash: one cheap lookup.
      if (hint && deps.confirmTransfer) {
        const ok = await deps.confirmTransfer(hint, search).catch(() => null);
        if (ok === true) return (await credit(hint)) ? hint : null;
        if (ok === false) return null; // that transaction is not this payment
        continue; // not finalized yet: ask again
      }
      // 2) No hash: search the recent blocks for exactly this transfer.
      if (!deps.findTransfers) return null;
      const hashes = await deps
        .findTransfers({
          sender: payer,
          recipient: deps.payTo,
          tokenId: deps.asset,
          amountRaw,
          decimals: deps.decimals,
          since,
        })
        .catch((err: unknown) => {
          console.error('[x402] on-chain check failed:', err instanceof Error ? err.message : err);
          return [] as string[];
        });
      for (const hash of hashes) {
        if (await credit(hash.toLowerCase())) return hash.toLowerCase();
      }
    }
    return null;
  }

  async function done(agentId: string, credits: number, txHash: string, settled: SettleResponse) {
    return {
      agentId,
      credits,
      txHash,
      responseHeader: encodePaymentResponseHeader(settled),
      creditsNow: await deps.seals.creditBalance(agentId),
    };
  }
}

export type SealBilling = ReturnType<typeof createSealBilling>;
