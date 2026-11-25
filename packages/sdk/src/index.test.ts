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

  /** Answers in order; an Error entry = the connection failed (like Node's "fetch failed"). */
  function scripted(answers: ({ status: number; body: unknown } | Error)[]) {
    const nonces: unknown[] = [];
    const waits: number[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      nonces.push((JSON.parse(String(init.body)) as { request: { nonce: unknown } }).request.nonce);
      const next = answers.shift();
      if (!next || next instanceof Error) throw next ?? new Error('no answer scripted');
      return new Response(JSON.stringify(next.body), { status: next.status });
    }) as unknown as typeof globalThis.fetch;
    const cachet = createCachetClient({
      baseUrl: 'http://x',
      badge: 'B',
      account: ACCOUNT,
      signer,
      fetch,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    return { cachet, nonces, waits };
  }

  it('closing keeps trying through a lost connection and a server error (phone hotspot during a call)', async () => {
    const { cachet, nonces, waits } = scripted([
      new TypeError('fetch failed'),
      { status: 503, body: { error: { code: 'unavailable' } } },
      { status: 200, body: { status: 'closed' } },
    ]);
    expect(await cachet.closeSeal('01ABC', 'completed')).toBe('closed');
    expect(waits).toEqual([1_000, 2_000]);
    expect(new Set(nonces).size).toBe(3); // every try is freshly signed
  });

  it('an earlier try that did reach Cachet (or an expired seal) counts as ended, not as an error', async () => {
    const { cachet } = scripted([
      new TypeError('fetch failed'),
      { status: 409, body: { error: { code: 'seal_not_open', message: 'no longer open' } } },
    ]);
    expect(await cachet.closeSeal('01ABC', 'completed')).toBe('already_ended');
  });

  it('a clear refusal is not retried', async () => {
    const { cachet, nonces } = scripted([
      { status: 401, body: { error: { code: 'seal_bad_signature', message: 'bad signature' } } },
    ]);
    await expect(cachet.closeSeal('01ABC', 'completed')).rejects.toMatchObject({
      code: 'seal_bad_signature',
    });
    expect(nonces).toHaveLength(1);
  });

  it('gives up after the retry window, with the last error', async () => {
    const { cachet, nonces } = scripted(Array.from({ length: 20 }, () => new TypeError('fetch failed')));
    await expect(cachet.closeSeal('01ABC', 'completed', { retryForMs: 5_000 })).rejects.toThrow(
      'fetch failed',
    );
    expect(nonces.length).toBeGreaterThan(1);
    expect(nonces.length).toBeLessThan(20);
  });
});
