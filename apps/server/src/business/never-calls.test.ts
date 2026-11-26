import { describe, expect, it } from 'vitest';
import { errorCode, setupSealing } from '../api/seal-test-setup';
import { ACCOUNT, makeTestApp, postJson, signInAsCompany } from '../api/test-helpers';
import { neverCallsLedgerHash } from './repo';

type Json = Record<string, unknown>;

describe('"We never make AI calls"', () => {
  it('a company with no AI caller can say so; then it may not add one', async () => {
    const { app, repo } = makeTestApp();
    const cookie = await signInAsCompany(app);
    const on = await app.request(postJson('/v1/business/never-calls', { neverCalls: true }, { cookie }));
    expect(on.status).toBe(200);
    expect(((await on.json()) as { business: Json }).business['neverCalls']).toBe(true);
    expect((await repo.findByAccount(ACCOUNT))?.neverCalls).toBe(true);

    const add = await app.request(
      postJson(
        '/v1/agents',
        {
          name: 'Sneaky caller',
          description: 'Should not exist.',
          purposes: ['billing'],
          language: 'en',
          callingNumbers: ['+31201234567'],
          agentAccount: '33Rcud5xa7UZT3JQawDw9rhp5X14H8MPmfGR9E1uHQ59mr1jVq',
        },
        { cookie },
      ),
    );
    expect(add.status).toBe(403);
    expect(await errorCode(add)).toBe('company_never_calls');
  });

  it('is refused while the company has a live AI caller', async () => {
    const ctx = await setupSealing();
    const cookie = await signInAsCompany(ctx.app);
    const res = await ctx.app.request(postJson('/v1/business/never-calls', { neverCalls: true }, { cookie }));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('never_calls_has_ai_caller');
  });

  it('a company that says it never calls gets no seals, and no credit is spent', async () => {
    const ctx = await setupSealing();
    const biz = await ctx.repo.findByAccount(ACCOUNT);
    await ctx.repo.setNeverCalls(biz?.id ?? '', true, new Date());
    const res = await ctx.seal();
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('company_never_calls');
    expect(await ctx.sealRepo.creditBalance(ctx.agentId)).toBe(10);
  });

  it('only its own company, from the website, with a strict body', async () => {
    const { app } = makeTestApp();
    expect((await app.request(postJson('/v1/business/never-calls', { neverCalls: true }))).status).toBe(401);
    const cookie = await signInAsCompany(app);
    const evil = await app.request(
      postJson('/v1/business/never-calls', { neverCalls: true }, { cookie, origin: 'https://evil.example' }),
    );
    expect(evil.status).toBe(403);
    const bad = await app.request(postJson('/v1/business/never-calls', { neverCalls: 'yes' }, { cookie }));
    expect(bad.status).toBe(400);
  });

  it('the permanent-record entry is a hash of the declaration only (nothing personal)', () => {
    const at = new Date('2026-11-26T10:00:00Z');
    const a = neverCallsLedgerHash('biz-1', true, at);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(neverCallsLedgerHash('biz-1', false, at)).not.toBe(a); // on and off are different records
  });
});
