import { describe, expect, it } from 'vitest';
import { memoHex } from '@cachet/concordium';
import { phoneHash } from '@cachet/shared/seal';
import { signInitData } from '../../miniapp/init-data';
import { CALLEE, TEST_PEPPER, errorCode, setupSealing, type Json } from '../seal-test-setup';
import { ACCOUNT, OTHER_ACCOUNT, TG_SECRET, postJson } from '../test-helpers';

const TG_USER = 777;
/** The person's wallet (real testnet address format; public). */
const PERSON = '4NHwrcmLseoKtrDaubCa5hoHqshiEte84RDSueGKjGM158mzMg';
const TX = 'ab'.repeat(32);

async function setup() {
  const ctx = await setupSealing();
  await ctx.people.register({
    tgUserId: TG_USER,
    chatId: TG_USER,
    phoneHash: phoneHash(TEST_PEPPER, CALLEE),
    phoneEnc: 'enc',
    lang: 'en',
  });
  ctx.payChain.balances.set(PERSON, 100_000_000n); // 100 test euro
  const auth = () =>
    signInitData(
      {
        user: JSON.stringify({ id: TG_USER, first_name: 'Asha' }),
        auth_date: String(Math.floor(ctx.clock.t / 1000) - 5),
      },
      TG_SECRET,
    );
  const call = (path: string, body: unknown) =>
    ctx.app.request(postJson(path, body, { authorization: `tma ${auth()}` }));
  const billSeal = async (over: Json = {}) =>
    (await (
      await ctx.seal(ctx.request({ amount: { value: '12.40', asset: 'EUDemo' }, ...over }))
    ).json()) as Json;
  const prepare = (sealId: unknown, sender = PERSON) =>
    call(`/v1/tg/pay/${String(sealId)}/prepare`, { sender });
  const confirm = (sealId: unknown, txHash = TX) => call(`/v1/tg/pay/${String(sealId)}/confirm`, { txHash });
  /** A finalized summary exactly like the real testnet one, paying this seal. */
  const summary = (
    sealId: unknown,
    over: { value?: string; to?: string; memo?: string; type?: string } = {},
  ) => ({
    type: 'accountTransaction',
    transactionType: over.type ?? 'tokenUpdate',
    cost: '0',
    sender: PERSON,
    sponsor: { cost: '6167602', sponsor: OTHER_ACCOUNT },
    events: [
      {
        tag: 'TokenTransfer',
        tokenId: 'EUDemo',
        from: { type: 'account', address: PERSON },
        to: { type: 'account', address: over.to ?? ACCOUNT },
        amount: { value: over.value ?? '12400000', decimals: 6 },
        memo: over.memo ?? memoHex(`cachet:${String(sealId)}`),
      },
    ],
  });
  const view = async (sealId: unknown) =>
    (await (
      await ctx.app.request(`/v1/tg/seals/${String(sealId)}`, { headers: { authorization: `tma ${auth()}` } })
    ).json()) as Json;
  return { ...ctx, billSeal, prepare, confirm, summary, view, tgAuth: auth };
}

describe('safe payment: prepare', () => {
  it('builds exactly the seal amount, to the on-chain agentWallet, with the seal memo', async () => {
    const t = await setup();
    const seal = await t.billSeal();
    const res = await t.prepare(seal['sealId']);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body).toMatchObject({
      amount: { value: '12.40', asset: 'EUDemo' },
      company: 'Northwind Energy BV',
      recipient: ACCOUNT,
      sender: PERSON,
    });
    expect(typeof body['transaction']).toBe('string');
    expect(t.payChain.built).toEqual([
      {
        sender: PERSON,
        recipient: ACCOUNT,
        tokenId: 'EUDemo',
        decimals: 6,
        amount: '12.40',
        memo: `cachet:${String(seal['sealId'])}`,
      },
    ]);
  });

  it('refuses when there is nothing to pay or the call is no longer verified', async () => {
    const t = await setup();
    const free = (await (await t.seal()).json()) as Json;
    expect(await errorCode(await t.prepare(free['sealId']))).toBe('pay_not_requested');

    const ended = await t.billSeal();
    await t.close(String(ended['sealId']));
    expect(await errorCode(await t.prepare(ended['sealId']))).toBe('pay_closed');

    const revoked = await t.billSeal();
    const live = t.chain.onChain.get(42n);
    if (live) t.chain.onChain.set(42n, { ...live, status: 'Revoked' as never });
    expect(await errorCode(await t.prepare(revoked['sealId']))).toBe('pay_closed');
    expect(t.payChain.built).toHaveLength(0);
  });

  it("someone else's seal is 'not found'", async () => {
    const t = await setup();
    const other = await t.billSeal({ to: '+919999999999' });
    expect((await t.prepare(other['sealId'])).status).toBe(404);
  });

  it('checks the wallet first: bad address, unknown account, not enough money', async () => {
    const t = await setup();
    const seal = await t.billSeal();
    expect(await errorCode(await t.prepare(seal['sealId'], `${PERSON.slice(0, -1)}X`))).toBe(
      'pay_invalid_account',
    );
    expect(await errorCode(await t.prepare(seal['sealId'], OTHER_ACCOUNT))).toBe('pay_account_not_found');
    t.payChain.balances.set(PERSON, 12_399_999n);
    expect(await errorCode(await t.prepare(seal['sealId']))).toBe('pay_insufficient_funds');
    expect(t.payChain.built).toHaveLength(0);
  });

  it('limits tries per call (each prepared transfer is a fee Cachet may pay)', async () => {
    const t = await setup();
    const seal = await t.billSeal();
    for (let i = 0; i < 5; i++) expect((await t.prepare(seal['sealId'])).status).toBe(200);
    expect(await errorCode(await t.prepare(seal['sealId']))).toBe('pay_too_many_attempts');
  });

  it('only one wallet at a time: a second wallet cannot start paying the same bill', async () => {
    const t = await setup();
    t.payChain.balances.set(OTHER_ACCOUNT, 100_000_000n);
    const seal = await t.billSeal();
    expect((await t.prepare(seal['sealId'])).status).toBe(200);
    expect(await errorCode(await t.prepare(seal['sealId'], OTHER_ACCOUNT))).toBe('pay_in_progress');
    // 6 minutes later the first wallet's transfer can no longer be sent (5-minute expiry), and the
    // seal (15 minutes) is still open: now the other wallet may pay this same bill.
    t.clock.t += 6 * 60 * 1000;
    expect((await t.prepare(seal['sealId'], OTHER_ACCOUNT)).status).toBe(200);
  });
});

describe("safe payment in the phone's browser (one-time pass from the Mini App)", () => {
  async function withPass() {
    const t = await setup();
    const seal = await t.billSeal();
    const res = await t.app.request(
      postJson(`/v1/tg/pay/${String(seal['sealId'])}/handoff`, {}, { authorization: `tma ${t.tgAuth()}` }),
    );
    expect(res.status).toBe(200);
    const { pass } = (await res.json()) as { pass: string };
    const browser = (path: string, body?: unknown, p = pass) =>
      t.app.request(
        body === undefined
          ? new Request(`http://localhost${path}`, { headers: { authorization: `Pay ${p}` } })
          : postJson(path, body, { authorization: `Pay ${p}` }),
      );
    return { t, seal, pass, browser };
  }

  it('the pass shows only what is needed to pay (no call code) and pays this seal', async () => {
    const { t, seal, browser } = await withPass();
    const view = (await (await browser(`/v1/pay/${String(seal['sealId'])}`)).json()) as Json;
    expect(view['pay']).toMatchObject({ recipient: ACCOUNT, ready: true });
    expect(JSON.stringify(view)).not.toContain(String(seal['code']).replace('-', ''));
    expect((await browser(`/v1/pay/${String(seal['sealId'])}/prepare`, { sender: PERSON })).status).toBe(200);
    t.payChain.summaries.set(TX, t.summary(seal['sealId']));
    const done = await browser(`/v1/pay/${String(seal['sealId'])}/confirm`, { txHash: TX });
    expect(((await done.json()) as Json)['status']).toBe('paid');
  });

  it('a pass works for its own seal only, and not without it', async () => {
    const { t, browser } = await withPass();
    const other = await t.billSeal({ to: '+919999999999' });
    expect(await errorCode(await browser(`/v1/pay/${String(other['sealId'])}`))).toBe('pay_pass_invalid');
    const none = await t.app.request(`/v1/pay/${String(other['sealId'])}`);
    expect(none.status).toBe(401);
    expect(
      await errorCode(await browser(`/v1/pay/${String(other['sealId'])}`, undefined, 'x'.repeat(32))),
    ).toBe('pay_pass_invalid');
  });

  it('the pass expires after 30 minutes', async () => {
    const { t, seal, browser } = await withPass();
    t.clock.t += 31 * 60 * 1000;
    expect(await errorCode(await browser(`/v1/pay/${String(seal['sealId'])}`))).toBe('pay_pass_invalid');
  });

  it('no pass for a bill that is paid or no longer verified', async () => {
    const t = await setup();
    const seal = await t.billSeal();
    await t.close(String(seal['sealId']));
    const res = await t.app.request(
      postJson(`/v1/tg/pay/${String(seal['sealId'])}/handoff`, {}, { authorization: `tma ${t.tgAuth()}` }),
    );
    expect(await errorCode(res)).toBe('pay_closed');
  });
});

describe('safe payment: confirm', () => {
  it('records a checked payment once, tells the bot, and closes paying', async () => {
    const t = await setup();
    const seal = await t.billSeal();
    await t.prepare(seal['sealId']);
    t.payChain.summaries.set(TX, t.summary(seal['sealId']));
    const res = await t.confirm(seal['sealId']);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body).toMatchObject({ status: 'paid', txHash: TX });
    expect(String(body['txUrl'])).toContain(TX);
    expect(t.paymentsRepo.rows).toHaveLength(1);
    expect(t.paymentsRepo.rows[0]).toMatchObject({
      payer: PERSON,
      recipient: ACCOUNT,
      amount: '12.40',
      sponsored: true,
    });
    const event = t.kv.published
      .map((p) => JSON.parse(p.message) as Json)
      .find((e) => e['type'] === 'seal.paid');
    expect(event).toMatchObject({ sealId: seal['sealId'], txHash: TX });
    expect(JSON.stringify(event)).not.toContain('9336124858');

    // Same tx again: same answer, nothing new. Paying again: refused.
    expect((await t.confirm(seal['sealId'])).status).toBe(200);
    expect(t.paymentsRepo.rows).toHaveLength(1);
    expect(await errorCode(await t.prepare(seal['sealId']))).toBe('pay_already_paid');
    const v = await t.view(seal['sealId']);
    expect(v['pay']).toMatchObject({ ready: false });
    expect(v['paid']).toMatchObject({ txHash: TX });
  });

  it('refuses a transaction that is not exactly this payment', async () => {
    const t = await setup();
    const seal = await t.billSeal();
    await t.prepare(seal['sealId']);
    const cases: [Parameters<typeof t.summary>[1], string][] = [
      [{ value: '1240000' }, 'pay_mismatch'], // €1.24 instead of €12.40
      [{ to: OTHER_ACCOUNT }, 'pay_mismatch'], // somebody else's wallet
      [{ memo: memoHex('cachet:01AAAAAAAAAAAAAAAAAAAAAAAA') }, 'pay_mismatch'], // another seal
      [{ type: 'failed' }, 'pay_failed'],
    ];
    for (const [over, code] of cases) {
      t.payChain.summaries.set(TX, t.summary(seal['sealId'], over));
      expect(await errorCode(await t.confirm(seal['sealId']))).toBe(code);
    }
    expect(t.paymentsRepo.rows).toHaveLength(0);
  });

  it('not finalized yet → "pending" (the Mini App asks again)', async () => {
    const t = await setup();
    const seal = await t.billSeal();
    await t.prepare(seal['sealId']);
    const res = await t.confirm(seal['sealId']);
    expect(res.status).toBe(202);
    expect(await errorCode(res)).toBe('pay_pending');
  });
});
