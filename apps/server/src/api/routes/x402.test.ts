import { describe, expect, it } from 'vitest';
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from '@x402/core/http';
import type { PaymentRequirements } from '@x402/core/types';
import type { Seal } from '@cachet/shared/seal';
import { AGENT_ACCOUNT, errorCode, setupSealing, type Json } from '../seal-test-setup';
import { FEE_PAYER, OTHER_ACCOUNT, TREASURY, X402_NETWORK, postJson } from '../test-helpers';

type Ctx = Awaited<ReturnType<typeof setupSealing>>;

/** What an x402 client would send back: it accepted exactly these terms and signed a transfer. */
function payment(accepted: PaymentRequirements, sender = AGENT_ACCOUNT) {
  return encodePaymentSignatureHeader({
    x402Version: 2,
    resource: { url: 'http://localhost/v1/credits/purchase' },
    accepted,
    payload: { signedTransaction: { version: 1 }, sender },
  } as never);
}

const termsOf = (res: Response) => {
  const header = res.headers.get('PAYMENT-REQUIRED');
  if (!header) throw new Error('no PAYMENT-REQUIRED header');
  return decodePaymentRequiredHeader(header);
};

async function buy(t: Ctx, credits: number, paymentHeader?: string) {
  return t.app.request(
    postJson(
      `/v1/credits/purchase?credits=${credits}`,
      {},
      paymentHeader ? { 'payment-signature': paymentHeader } : {},
    ),
  );
}

describe('x402: buying seal credits', () => {
  it('without payment: 402 with the exact terms (EUDemo, treasury, Cachet pays the fee)', async () => {
    const t = await setupSealing();
    const res = await buy(t, 100);
    expect(res.status).toBe(402);
    expect(await errorCode(res)).toBe('payment_required');
    const terms = termsOf(res);
    expect(terms.accepts).toHaveLength(1);
    expect(terms.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: X402_NETWORK,
      amount: '1000000', // 100 seals × €0.01 = 1.00 EUDemo (6 decimals)
      asset: 'EUDemo',
      payTo: TREASURY,
      extra: { feePayer: FEE_PAYER },
    });
    expect(t.x402.calls).toHaveLength(0);
  });

  it('pays, settles, THEN credits the AI caller that paid (once per transaction)', async () => {
    const t = await setupSealing({}, 0);
    const terms = termsOf(await buy(t, 100));
    const res = await buy(t, 100, payment(terms.accepts[0] as PaymentRequirements));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body).toMatchObject({ credits: 100, creditsNow: 100, txHash: t.x402.tx });
    expect(String(body['txUrl'])).toContain(`ccdexplorer.io/testnet/transaction/${t.x402.tx}`);
    expect(t.x402.calls.map((c) => c.op)).toEqual(['verify', 'settle']);
    expect(decodePaymentResponseHeader(res.headers.get('PAYMENT-RESPONSE') ?? '')).toMatchObject({
      success: true,
      transaction: t.x402.tx,
    });
    // The same settlement can never be credited twice.
    await buy(t, 100, payment(terms.accepts[0] as PaymentRequirements));
    expect(await t.sealRepo.creditBalance(t.agentId)).toBe(100);
  });

  it('a payer that is not an active AI caller: refused BEFORE anything is settled', async () => {
    const t = await setupSealing({}, 0);
    t.x402.payer = OTHER_ACCOUNT;
    const terms = termsOf(await buy(t, 10));
    const res = await buy(t, 10, payment(terms.accepts[0] as PaymentRequirements, OTHER_ACCOUNT));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('x402_unknown_payer');
    expect(t.x402.calls.map((c) => c.op)).toEqual(['verify']); // never settled
  });

  it('terms changed by the client (cheaper amount, other recipient) → refused without asking the facilitator', async () => {
    const t = await setupSealing({}, 0);
    const accepted = termsOf(await buy(t, 100)).accepts[0] as PaymentRequirements;
    for (const forged of [
      { ...accepted, amount: '1' },
      { ...accepted, payTo: OTHER_ACCOUNT },
    ]) {
      const res = await buy(t, 100, payment(forged));
      expect(await errorCode(res)).toBe('x402_invalid');
    }
    // A payment for 10 credits can't buy 100.
    const ten = termsOf(await buy(t, 10)).accepts[0] as PaymentRequirements;
    expect(await errorCode(await buy(t, 100, payment(ten)))).toBe('x402_invalid');
    expect(t.x402.calls).toHaveLength(0);
  });

  it('facilitator says invalid, or settlement fails → no credits', async () => {
    const t = await setupSealing({}, 0);
    const accepted = termsOf(await buy(t, 10)).accepts[0] as PaymentRequirements;
    t.x402.valid = false;
    expect(await errorCode(await buy(t, 10, payment(accepted)))).toBe('x402_invalid');
    t.x402.valid = true;
    t.x402.settleOk = false;
    expect(await errorCode(await buy(t, 10, payment(accepted)))).toBe('x402_settle_failed');
    expect(await t.sealRepo.creditBalance(t.agentId)).toBe(0);
  });

  it('facilitator says "failed" but the transfer IS on chain → credited anyway (seen live with the hosted one)', async () => {
    const t = await setupSealing({}, 0);
    const accepted = termsOf(await buy(t, 10)).accepts[0] as PaymentRequirements;
    t.x402.settleOk = false;
    t.x402.onChain = ['ef'.repeat(32)];
    const res = await buy(t, 10, payment(accepted));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json)['txHash']).toBe('ef'.repeat(32));
    expect(await t.sealRepo.creditBalance(t.agentId)).toBe(10);
    // The same on-chain transfer can't be counted again by a later "failed" settlement.
    const again = await buy(t, 10, payment(accepted));
    expect(await errorCode(again)).toBe('x402_settle_failed');
    expect(await t.sealRepo.creditBalance(t.agentId)).toBe(10);
  });

  it('a "failed" answer that names the transaction: one lookup confirms it, credits added', async () => {
    const t = await setupSealing({}, 0);
    const accepted = termsOf(await buy(t, 10)).accepts[0] as PaymentRequirements;
    t.x402.settleOk = false;
    t.x402.failTx = '12'.repeat(32);
    t.x402.onChain = ['12'.repeat(32)];
    const res = await buy(t, 10, payment(accepted));
    expect(((await res.json()) as Json)['txHash']).toBe('12'.repeat(32));
    expect(await t.sealRepo.creditBalance(t.agentId)).toBe(10);
  });

  it('facilitator times out and nothing is on chain → error, no credits', async () => {
    const t = await setupSealing({}, 0);
    const accepted = termsOf(await buy(t, 10)).accepts[0] as PaymentRequirements;
    t.x402.settleThrows = true;
    expect(await errorCode(await buy(t, 10, payment(accepted)))).toBe('x402_settle_failed');
    expect(await t.sealRepo.creditBalance(t.agentId)).toBe(0);
    // …but if the transfer shows up on chain, the timeout doesn't lose the money either.
    t.x402.onChain = ['aa'.repeat(32)];
    expect((await buy(t, 10, payment(accepted))).status).toBe(200);
    expect(await t.sealRepo.creditBalance(t.agentId)).toBe(10);
  });

  it('only fixed packs; garbage payment headers are refused', async () => {
    const t = await setupSealing();
    expect((await buy(t, 7)).status).toBe(400);
    expect(await errorCode(await buy(t, 10, 'not-base64-json'))).toBe('x402_invalid');
  });
});

describe('x402: paying per seal when credits run out', () => {
  it('402 first (nonce NOT used), then the SAME signed request with payment gets the seal', async () => {
    const t = await setupSealing({}, 0);
    const request = t.request();
    const first = await t.seal(request);
    expect(first.status).toBe(402);
    const accepted = termsOf(first).accepts[0] as PaymentRequirements;
    expect(accepted).toMatchObject({ amount: '10000', asset: 'EUDemo', payTo: TREASURY }); // €0.01

    const paid = await t.app.request(
      postJson(
        '/v1/seals',
        { request, signature: { 0: { 0: 'ab'.repeat(64) } } },
        { 'payment-signature': payment(accepted) },
      ),
    );
    expect(paid.status).toBe(201);
    expect(paid.headers.get('PAYMENT-RESPONSE')).toBeTruthy();
    const body = (await paid.json()) as Json;
    expect(body['creditsLeft']).toBe(0); // bought one, used one
    const stored = JSON.parse(t.sealRepo.sealRows.get(String(body['sealId']))?.sealJson ?? '{}') as Seal;
    expect(stored.payment).toEqual({ method: 'x402-credit', ref: t.x402.tx });
  });

  it("a payment from someone else's account can't pay for this AI caller's seal", async () => {
    const t = await setupSealing({}, 0);
    const request = t.request();
    const accepted = termsOf(await t.seal(request)).accepts[0] as PaymentRequirements;
    t.x402.payer = OTHER_ACCOUNT;
    const res = await t.app.request(
      postJson(
        '/v1/seals',
        { request, signature: { 0: { 0: 'ab'.repeat(64) } } },
        { 'payment-signature': payment(accepted, OTHER_ACCOUNT) },
      ),
    );
    expect(await errorCode(res)).toBe('x402_wrong_payer');
    expect(t.x402.calls.map((c) => c.op)).toEqual(['verify']);
    expect(t.sealRepo.sealRows.size).toBe(0);
  });

  it('only a genuine, fresh, unused request is asked to pay (no 402 for replays, stale or forged ones)', async () => {
    const t = await setupSealing({}, 0);
    const stale = t.request({ ts: Math.floor(t.clock.t / 1000) - 600 });
    expect(await errorCode(await t.seal(stale))).toBe('seal_stale');
    const forged = await setupSealing(
      { verifyAgentMessage: async () => ({ ok: false, reason: 'bad_signature' }) },
      0,
    );
    expect(await errorCode(await forged.seal())).toBe('seal_bad_signature');
    // A request whose nonce was already used (a replay) → 409, not a payment request.
    const t2 = await setupSealing({}, 1);
    const request = t2.request();
    expect((await t2.seal(request)).status).toBe(201); // uses the last credit
    expect(await errorCode(await t2.seal(request))).toBe('seal_replay');
    expect(t.x402.calls).toHaveLength(0);
  });

  it('with credits left, no payment is asked', async () => {
    const t = await setupSealing({}, 3);
    expect((await t.seal()).status).toBe(201);
    expect(t.x402.calls).toHaveLength(0);
  });
});
