import { Hono, type Context } from 'hono';
import { explorerTxUrl, type Network } from '@cachet/shared';
import type { KvStore } from '../../infra/kv';
import { BillingError, CREDIT_PACKS, type SealBilling } from '../../x402/billing';
import { apiError } from '../errors';
import { rateLimit } from '../middleware';

export interface CreditRouteDeps {
  kv: KvStore;
  billing: SealBilling;
  network: Network;
  trustProxy: boolean;
}

/** x402 v2 header names. */
export const PAYMENT_SIGNATURE = 'payment-signature';
export const PAYMENT_REQUIRED = 'PAYMENT-REQUIRED';
export const PAYMENT_RESPONSE = 'PAYMENT-RESPONSE';

export function billingFail(c: Context, err: unknown) {
  if (err instanceof BillingError) {
    if (err.detail) console.warn(`[x402] ${err.code}: ${err.detail}`);
    return apiError(c, err.code);
  }
  throw err;
}

/** Answer "402 Payment Required" the x402 way (header) and the human way (JSON). */
export async function paymentRequired(
  c: Context,
  billing: SealBilling,
  credits: number,
  description: string,
) {
  const required = await billing.paymentRequired(credits, c.req.url, description);
  const price = billing.priceOf(credits);
  c.header(PAYMENT_REQUIRED, required.header);
  c.header('Cache-Control', 'no-store');
  return c.json(
    {
      error: {
        code: 'payment_required',
        message: `Pay ${price.decimal} to get ${credits} seal credit${credits === 1 ? '' : 's'} (x402).`,
      },
      x402: required.body,
    },
    402,
  );
}

/**
 * POST /v1/credits/purchase?credits=100[&badge=…]: buy seal credits with x402 (plan §13.1).
 * Without a payment → 402 with the exact terms. With a payment (PAYMENT-SIGNATURE) → settled on
 * chain, then credited to the AI caller that paid.
 */
export function creditRoutes(deps: CreditRouteDeps) {
  const app = new Hono();

  app.post(
    '/purchase',
    rateLimit({ kv: deps.kv, name: 'credits', limit: 60, windowSeconds: 600, trustProxy: deps.trustProxy }),
    async (c) => {
      const credits = Number(c.req.query('credits') ?? '100');
      if (!(CREDIT_PACKS as readonly number[]).includes(credits)) return apiError(c, 'invalid_request');
      const badge = c.req.query('badge') || undefined;
      const header = c.req.header(PAYMENT_SIGNATURE);
      try {
        if (!header) return await paymentRequired(c, deps.billing, credits, `${credits} Cachet seal credits`);
        const bought = await deps.billing.purchase({ header, credits, badge });
        c.header(PAYMENT_RESPONSE, bought.responseHeader);
        return c.json({
          credits: bought.credits,
          creditsNow: bought.creditsNow,
          txHash: bought.txHash,
          txUrl: explorerTxUrl(deps.network, bought.txHash),
        });
      } catch (err) {
        return billingFail(c, err);
      }
    },
  );

  return app;
}
