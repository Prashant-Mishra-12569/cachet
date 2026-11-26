import { describe, expect, it } from 'vitest';
import { phoneHash } from '@cachet/shared/seal';
import { signInitData } from '../miniapp/init-data';
import { errorCode, setupSealing, TEST_PEPPER, type Json } from '../api/seal-test-setup';
import { ACCOUNT, TG_SECRET, postJson } from '../api/test-helpers';
import { DEFAULT_RISK_RULE, shouldSuspend, suspendAt } from './risk';

describe('risk rule', () => {
  it('needs several people AND a share of everyone called', () => {
    expect(suspendAt(10, DEFAULT_RISK_RULE)).toBe(5); // small company: at least 5 people
    expect(suspendAt(200, DEFAULT_RISK_RULE)).toBe(20); // bigger: 10% of the people it called
    expect(shouldSuspend({ reporters: 4, called: 10 }, DEFAULT_RISK_RULE)).toBe(false);
    expect(shouldSuspend({ reporters: 5, called: 10 }, DEFAULT_RISK_RULE)).toBe(true);
    expect(shouldSuspend({ reporters: 19, called: 200 }, DEFAULT_RISK_RULE)).toBe(false);
  });
});

/** N different people, each receiving one sealed call from the company. */
async function setup(people: number) {
  const ctx = await setupSealing({}, 100);
  const sealIds: string[] = [];
  const auths: string[] = [];
  for (let i = 0; i < people; i++) {
    const to = `+9199999000${String(i).padStart(2, '0')}`;
    await ctx.people.register({
      tgUserId: 1000 + i,
      chatId: 1000 + i,
      phoneHash: phoneHash(TEST_PEPPER, to),
      phoneEnc: 'enc',
      lang: 'en',
    });
    const seal = (await (await ctx.seal(ctx.request({ to }))).json()) as Json;
    sealIds.push(String(seal['sealId']));
    auths.push(
      signInitData(
        {
          user: JSON.stringify({ id: 1000 + i, first_name: 'P' }),
          auth_date: String(Math.floor(ctx.clock.t / 1000)),
        },
        TG_SECRET,
      ),
    );
  }
  const report = (i: number, sealId = sealIds[i] ?? '', category = 'pressure') =>
    ctx.app.request(
      postJson(`/v1/tg/seals/${sealId}/report`, { category }, { authorization: `tma ${auths[i] ?? ''}` }),
    );
  return { ...ctx, sealIds, report };
}

describe('reporting a sealed call', () => {
  it('only the person who got the call, once per call', async () => {
    const t = await setup(2);
    expect((await t.report(1, t.sealIds[0])).status).toBe(404); // someone else's seal looks missing
    const first = (await (await t.report(0)).json()) as Json;
    const again = (await (await t.report(0)).json()) as Json;
    expect(first).toEqual({ reported: true, alreadyReported: false });
    expect(again).toEqual({ reported: true, alreadyReported: true });
    expect(t.reportsRepo.rows).toHaveLength(1);
    expect(t.reportsRepo.rows[0]).toMatchObject({ reason: 'sealed_call:pressure', sealId: t.sealIds[0] });
  });

  it('refuses unknown categories and extra fields', async () => {
    const t = await setup(1);
    expect((await t.report(0, t.sealIds[0], 'because')).status).toBe(400);
  });
});

describe('automatic suspension', () => {
  it('4 of 10 people reporting: still active', async () => {
    const t = await setup(10);
    for (let i = 0; i < 4; i++) await t.report(i);
    expect((await t.repo.findByAccount(ACCOUNT))?.status).toBe('active');
  });

  it('the 5th of 10: suspended, its open seals end, and it gets no new seals', async () => {
    const t = await setup(10);
    for (let i = 0; i < 5; i++) await t.report(i);
    expect((await t.repo.findByAccount(ACCOUNT))?.status).toBe('suspended');
    const open = [...t.sealRepo.sealRows.values()].filter((r) => r.status === 'open');
    expect(open).toHaveLength(0);
    const closed = t.sealRepo.sealRows.get(t.sealIds[9] ?? '');
    expect(closed?.closeReason).toBe('company_suspended');
    const res = await t.seal(t.request({ to: '+919999900001' }));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('business_suspended');
  });

  it('one person reporting the same company many times counts once', async () => {
    const t = await setup(10);
    for (let k = 0; k < 6; k++) await t.report(0);
    expect((await t.repo.findByAccount(ACCOUNT))?.status).toBe('active');
  });
});
