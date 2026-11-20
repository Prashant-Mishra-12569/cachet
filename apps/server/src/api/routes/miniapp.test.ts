import { describe, expect, it } from 'vitest';
import { phoneHash } from '@cachet/shared/seal';
import { signInitData } from '../../miniapp/init-data';
import { ACCOUNT, TG_SECRET } from '../test-helpers';
import { CALLEE, TEST_PEPPER, errorCode, setupSealing, type Json } from '../seal-test-setup';

const TG_USER = 777;

async function setup() {
  const ctx = await setupSealing();
  const person = await ctx.people.register({
    tgUserId: TG_USER,
    chatId: TG_USER,
    phoneHash: phoneHash(TEST_PEPPER, CALLEE),
    phoneEnc: 'enc',
    lang: 'en',
  });
  const initData = (userId = TG_USER, authDate = Math.floor(ctx.clock.t / 1000) - 10) =>
    signInitData(
      { user: JSON.stringify({ id: userId, first_name: 'Asha' }), auth_date: String(authDate) },
      TG_SECRET,
    );
  const get = (path: string, auth: string | null = initData()) =>
    ctx.app.request(path, auth === null ? {} : { headers: { authorization: `tma ${auth}` } });
  return { ...ctx, person, initData, get };
}

describe('Mini App API: who may see what', () => {
  it('refuses requests that are not signed by Telegram', async () => {
    const t = await setup();
    const none = await t.get('/v1/tg/me', null);
    expect(none.status).toBe(401);
    expect(await errorCode(none)).toBe('tg_auth_failed');
    const forged = await t.get('/v1/tg/me', t.initData().replace('Asha', 'Eve'));
    expect(await errorCode(forged)).toBe('tg_auth_failed');
  });

  it('an old launch must be reopened', async () => {
    const t = await setup();
    const res = await t.get('/v1/tg/me', t.initData(TG_USER, Math.floor(t.clock.t / 1000) - 7200));
    expect(await errorCode(res)).toBe('tg_session_expired');
  });

  it('a Telegram user who never shared their number gets nothing', async () => {
    const t = await setup();
    const res = await t.get('/v1/tg/me', t.initData(999));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('tg_not_registered');
  });

  it('home: my sealed calls, with the code only while the call is open', async () => {
    const t = await setup();
    const ended = (await (await t.seal()).json()) as Json;
    await t.close(String(ended['sealId']));
    t.clock.t += 2000; // a later call (the test clock is frozen otherwise)
    const open = (await (
      await t.seal(t.request({ amount: { value: '12.40', asset: 'EUDemo' } }))
    ).json()) as Json;
    const res = await t.get('/v1/tg/me');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = (await res.json()) as { calls: Json[]; firstName: string; family: Json };
    expect(body.firstName).toBe('Asha');
    expect(body.calls.map((c) => [c['sealId'], c['status'], c['code']])).toEqual([
      [open['sealId'], 'open', open['code']],
      [ended['sealId'], 'closed', null],
    ]);
    expect(body.family).toEqual({ protects: [], protectedBy: [] });
    expect(JSON.stringify(body)).not.toContain('9336124858');
  });

  it('seal details: my own seal with code + safe-payment recipient from the Agent Registry', async () => {
    const t = await setup();
    const issued = (await (
      await t.seal(t.request({ amount: { value: '12.40', asset: 'EUDemo' } }))
    ).json()) as Json;
    const res = await t.get(`/v1/tg/seals/${String(issued['sealId'])}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body['code']).toBe(issued['code']);
    expect(body['status']).toBe('open');
    expect(body['pay']).toEqual({
      amount: { value: '12.40', asset: 'EUDemo' },
      company: 'Northwind Energy BV',
      recipient: ACCOUNT, // the on-chain agentWallet, not anything from the call
      fee: 'free',
      ready: true,
    });
    expect((body['company'] as Json)['proofTxUrl']).toMatch(/^https:\/\//);
  });

  it('no payment while the AI caller is switched off on chain', async () => {
    const t = await setup();
    const issued = (await (
      await t.seal(t.request({ amount: { value: '12.40', asset: 'EUDemo' } }))
    ).json()) as Json;
    const live = t.chain.onChain.get(42n);
    if (live) t.chain.onChain.set(42n, { ...live, status: 'Revoked' as never });
    t.clock.t += 60_000; // past the short on-chain cache
    const body = (await (
      await t.get(
        `/v1/tg/seals/${String(issued['sealId'])}`,
        t.initData(TG_USER, Math.floor(t.clock.t / 1000)),
      )
    ).json()) as Json;
    expect(body['pay']).toMatchObject({ recipient: null, ready: false });
  });

  it("someone else's seal is 'not found' (not 'forbidden'), even with a valid sign-in", async () => {
    const t = await setup();
    const other = (await (await t.seal(t.request({ to: '+919999999999' }))).json()) as Json;
    const res = await t.get(`/v1/tg/seals/${String(other['sealId'])}`);
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe('seal_not_found');
    const bad = await t.get('/v1/tg/seals/not-a-ulid');
    expect(bad.status).toBe(404);
  });
});
