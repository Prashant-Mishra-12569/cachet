import { describe, expect, it } from 'vitest';
import { CALLEE, errorCode, setupSealing, type Json } from '../seal-test-setup';
import { postJson } from '../test-helpers';

/** An AI answering a call asks Cachet: is there a verified call to my number with the code I heard? */
async function sealedCall() {
  const ctx = await setupSealing();
  const body = (await (await ctx.seal()).json()) as Json;
  const verify = (to: string, code: string) => ctx.app.request(postJson('/v1/calls/verify', { to, code }));
  return { ...ctx, sealId: String(body['sealId']), code: String(body['code']), verify };
}

describe('agent-to-agent call verification (POST /v1/calls/verify)', () => {
  it('the right number and the spoken code: verified, with the company and the live AI caller', async () => {
    const t = await sealedCall();
    const res = await t.verify(CALLEE, t.code.replace('-', ' ')); // "47 21", as heard
    expect(res.status).toBe(200);
    const body = (await res.json()) as { verified: boolean; seal: Json };
    expect(body.verified).toBe(true);
    expect(body.seal).toMatchObject({
      id: t.sealId,
      status: 'open',
      company: { legalName: 'Northwind Energy BV', status: 'active' },
      agent: { onChain: 'active' },
    });
    // Never the code or the number in the answer.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('"code"');
    expect(raw).not.toContain(CALLEE);
  });

  it('a wrong code, another number, or an ended call: just "not verified"', async () => {
    const t = await sealedCall();
    const wrong = t.code === '12-34' ? '43-21' : '12-34';
    for (const [to, code] of [
      [CALLEE, wrong],
      ['+31612345678', t.code],
    ] as const) {
      expect(await (await t.verify(to, code)).json()).toEqual({ verified: false });
    }
    await t.close(t.sealId);
    expect(await (await t.verify(CALLEE, t.code)).json()).toEqual({ verified: false });
  });

  it('guessing codes for one number is stopped after 10 tries', async () => {
    const t = await sealedCall();
    for (let i = 0; i < 10; i++) expect((await t.verify(CALLEE, '00-00')).status).toBe(200);
    expect(await errorCode(await t.verify(CALLEE, t.code))).toBe('rate_limited');
  });

  it('refuses a malformed number or body', async () => {
    const t = await sealedCall();
    expect(await errorCode(await t.verify('not a number', '47-21'))).toBe('invalid_phone');
    expect(await errorCode(await t.app.request(postJson('/v1/calls/verify', { to: CALLEE })))).toBe(
      'invalid_request',
    );
  });
});
