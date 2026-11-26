import { describe, expect, it } from 'vitest';
import { setupSealing } from '../api/seal-test-setup';
import { ACCOUNT, makeTestApp } from '../api/test-helpers';

type Companies = {
  companies: {
    legalName: string;
    neverCalls: boolean;
    proofTxUrl: string;
    aiCallers: { name: string; callingNumbers: string[]; purposes: string[]; badgeCheckUrl: string | null }[];
  }[];
};

describe('GET /v1/companies (public lookup)', () => {
  it('a verified company with its live AI caller: name, numbers, purposes, badge check', async () => {
    const ctx = await setupSealing();
    const res = await ctx.app.request('/v1/companies?query=northwind');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Companies;
    expect(body.companies).toHaveLength(1);
    expect(body.companies[0]).toMatchObject({
      legalName: 'Northwind Energy BV',
      neverCalls: false,
      aiCallers: [
        {
          name: 'Northwind billing assistant',
          callingNumbers: ['+31201234567'],
          purposes: ['billing'],
          badgeCheckUrl: expect.stringMatching(/^https:\/\/registry\.test\/v1\/check-badge\//),
        },
      ],
    });
    expect(body.companies[0]?.proofTxUrl).toMatch(/^https:\/\/ccdexplorer\.io\/testnet\/transaction\//);
  });

  it('a company that never calls lists no AI callers', async () => {
    const ctx = await setupSealing();
    const biz = await ctx.repo.findByAccount(ACCOUNT);
    await ctx.repo.setNeverCalls(biz?.id ?? '', true, new Date());
    const body = (await (await ctx.app.request('/v1/companies?query=Northwind')).json()) as Companies;
    expect(body.companies[0]).toMatchObject({ neverCalls: true, aiCallers: [] });
  });

  it('never leaks private data (accounts, agent keys, wallets)', async () => {
    const ctx = await setupSealing();
    const text = await (await ctx.app.request('/v1/companies?query=northwind')).text();
    expect(text).not.toContain(ACCOUNT);
    expect(text).not.toContain('agentAccount');
    expect(text).not.toContain('33Rcud');
  });

  it('unknown names → empty list; too short or too long → 400', async () => {
    const { app } = makeTestApp();
    expect(((await (await app.request('/v1/companies?query=nobody')).json()) as Companies).companies).toEqual(
      [],
    );
    expect((await app.request('/v1/companies?query=a')).status).toBe(400);
    expect((await app.request(`/v1/companies?query=${'x'.repeat(61)}`)).status).toBe(400);
    expect((await app.request('/v1/companies')).status).toBe(400);
  });
});
