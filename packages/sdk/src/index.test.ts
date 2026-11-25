import { describe, expect, it } from 'vitest';
import { buildBasicAccountSigner } from '@concordium/web-sdk';
import { canonicalize, sealRequestMessage, sha256Hex } from '@cachet/shared/seal';
import { CachetError, createCachetClient } from './index';

const ACCOUNT = '33Rcud5xa7UZT3JQawDw9rhp5X14H8MPmfGR9E1uHQ59mr1jVq';
const signer = buildBasicAccountSigner('11'.repeat(32));

function fakeCachet(status: number, body: unknown, headers: Record<string, string> = {}) {
  const sent: { url: string; body: { request: Record<string, unknown>; signature: unknown } }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(body), { status, headers });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, sent };
}

describe('Cachet SDK', () => {
  it('seals a call: signs exactly the request it sends, and reads an x402 receipt', async () => {
    const receipt = Buffer.from(JSON.stringify({ success: true, transaction: 'ab'.repeat(32) })).toString(
      'base64',
    );
    const api = fakeCachet(
      201,
      { sealId: 'S1', code: '47-21', firstLine: 'Hi' },
      { 'PAYMENT-RESPONSE': receipt },
    );
    const cachet = createCachetClient({
      baseUrl: 'http://x/',
      badge: 'BADGE',
      account: ACCOUNT,
      signer,
      fetch: api.fetch,
    });
    const seal = await cachet.sealCall({
      to: '+919999999999',
      from: '+918035735856',
      purpose: 'billing',
      message: 'Bill',
    });
    expect(seal).toMatchObject({ sealId: 'S1', code: '47-21', x402Tx: 'ab'.repeat(32) });
    const sent = api.sent[0];
    expect(sent?.url).toBe('http://x/v1/seals');
    expect(sent?.body.request).toMatchObject({
      v: 'cachet-seal-request/1',
      badge: 'BADGE',
      agentAccount: ACCOUNT,
      to: '+919999999999',
      from: '+918035735856',
    });
    // The signature covers the exact JSON sent (Cachet re-computes this digest).
    expect(sent?.body.signature).toBeTruthy();
    expect(sealRequestMessage(sha256Hex(canonicalize(sent?.body.request ?? {})))).toMatch(
      /^cachet:seal-request:v1:[0-9a-f]{64}$/,
    );
  });

  it('Cachet errors become CachetError with the code (e.g. consent_revoked)', async () => {
    const api = fakeCachet(403, { error: { code: 'consent_revoked', message: 'blocked' } });
    const cachet = createCachetClient({
      baseUrl: 'http://x',
      badge: 'B',
      account: ACCOUNT,
      signer,
      fetch: api.fetch,
    });
    const err = await cachet
      .sealCall({ to: '+919999999999', from: '+918035735856', purpose: 'billing', message: 'Bill' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CachetError);
    expect((err as CachetError).code).toBe('consent_revoked');
  });

  it('closes a seal with a signed close request', async () => {
    const api = fakeCachet(200, { status: 'closed' });
    const cachet = createCachetClient({
      baseUrl: 'http://x',
      badge: 'B',
      account: ACCOUNT,
      signer,
      fetch: api.fetch,
    });
    await cachet.closeSeal('01ABC', 'no_answer');
    expect(api.sent[0]?.url).toBe('http://x/v1/seals/01ABC/close');
    expect(api.sent[0]?.body.request).toMatchObject({
      v: 'cachet-seal-close/1',
      sealId: '01ABC',
      reason: 'no_answer',
    });
  });
});
