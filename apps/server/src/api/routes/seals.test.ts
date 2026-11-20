import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  publicKeyFromJwk,
  sealCloseMessage,
  phoneHash,
  sealRequestMessage,
  sha256Hex,
  verifySealSignature,
  type Seal,
} from '@cachet/shared/seal';
import { ACCOUNT, OTHER_ACCOUNT, makeTestApp, postJson, signInAsCompany } from '../test-helpers';

type Json = Record<string, unknown>;
const AGENT_ACCOUNT = '33Rcud5xa7UZT3JQawDw9rhp5X14H8MPmfGR9E1uHQ59mr1jVq';
const CALLEE = '+919336124858';
const SIG = { 0: { 0: 'ab'.repeat(64) } };

const errorCode = async (res: Response) => (((await res.clone().json()) as Json)['error'] as Json)['code'];

/** A verified company with one fully active AI caller (token 42), on chain and in Cachet. */
async function setup(options: Parameters<typeof makeTestApp>[0] = {}, credits = 10) {
  const ctx = makeTestApp(options);
  const cookie = await signInAsCompany(ctx.app);
  const post = (path: string, body: unknown = {}) => ctx.app.request(postJson(path, body, { cookie }));
  const created = (await (
    await post('/v1/agents', {
      name: 'Northwind billing assistant',
      description: 'Calls customers about their bills.',
      purposes: ['billing'],
      language: 'en',
      callingNumbers: ['+31201234567'],
      agentAccount: AGENT_ACCOUNT,
    })
  ).json()) as { agent: Json };
  const id = String(created.agent['id']);
  ctx.chain.registerTx('1'.repeat(64), ACCOUNT, 42n);
  await post(`/v1/agents/${id}/register/confirm`, { txHash: '1'.repeat(64) });
  const card = (await (await post(`/v1/agents/${id}/card/prepare`)).json()) as { agent: Json };
  const uri = String(card.agent['agentUri']);
  const hash = String(card.agent['metadataHash']);
  ctx.chain.setUriTx('2'.repeat(64), ACCOUNT, 42n, uri, hash);
  await post(`/v1/agents/${id}/card/confirm`, { txHash: '2'.repeat(64) });

  ctx.chain.onChain.set(42n, {
    tokenId: 42n,
    owner: ACCOUNT,
    agentUri: uri,
    metadataHash: hash,
    agentWallet: ACCOUNT,
    status: 'Active',
  });
  if (credits > 0)
    await ctx.sealRepo.addCredits({
      agentId: id,
      credits,
      amount: '0.10',
      asset: 'EUDemo',
      txHash: 'f'.repeat(64),
    });

  const nowS = () => Math.floor(ctx.clock.t / 1000);
  const request = (over: Json = {}) => ({
    v: 'cachet-seal-request/1',
    badge: 'JyP9Badge42',
    agentAccount: AGENT_ACCOUNT,
    to: CALLEE,
    from: '+31201234567',
    purpose: 'billing',
    message: 'Your November bill is ready',
    nonce: randomBytes(16).toString('hex'),
    ts: nowS(),
    ...over,
  });
  const seal = (req: Json = request(), signature: unknown = SIG) =>
    ctx.app.request(postJson('/v1/seals', { request: req, signature }));
  const close = (sealId: string, over: Json = {}) =>
    ctx.app.request(
      postJson(`/v1/seals/${sealId}/close`, {
        request: {
          v: 'cachet-seal-close/1',
          sealId,
          agentAccount: AGENT_ACCOUNT,
          reason: 'completed',
          nonce: randomBytes(16).toString('hex'),
          ts: nowS(),
          ...over,
        },
        signature: SIG,
      }),
    );
  return { ...ctx, agentId: id, request, seal, close };
}

describe('POST /v1/seals: a sealed call', () => {
  it('issues a signed seal with a 4-digit code and the AI first line', async () => {
    const ctx = await setup();
    const req = ctx.request();
    const res = await ctx.seal(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Json;
    expect(body['code']).toMatch(/^\d{2}-\d{2}$/);
    expect(body['firstLine']).toMatch(
      /^Hi, this is Northwind Energy BV's AI assistant\. Your Cachet code is \w+-\w+, \w+-\w+\.$/,
    );
    expect(body['verifyUrl']).toBe(`http://localhost:3000/v/${String(body['sealId'])}`);
    expect(body['creditsLeft']).toBe(9);

    // The server checked the AI's signature over the digest of EXACTLY what it sent.
    expect(ctx.checkedMessages).toContainEqual({
      address: AGENT_ACCOUNT,
      message: sealRequestMessage(sha256Hex(canonicalize(req))),
    });

    const row = ctx.sealRepo.sealRows.get(String(body['sealId']));
    expect(row?.status).toBe('open');
    const stored = JSON.parse(row?.sealJson ?? '{}') as Seal;
    expect(stored.code).toBe(String(body['code']).replace('-', ''));
    expect(stored.company).toMatchObject({
      legalName: 'Northwind Energy BV',
      legalCountry: 'NL',
      account: ACCOUNT,
    });
    expect(stored.agent.badge).toBe('ccd:4221332d34e1694168c2a0c0b3fd0f27/cis-2:JyP9Badge42');
    expect(stored.consent).toBe('none_recorded');
    expect(stored.expiresAt - stored.issuedAt).toBe(15 * 60);
    // Privacy: the number itself is nowhere in the seal, the event, or the ledger.
    expect(row?.sealJson).not.toContain('9336124858');
    expect(JSON.stringify(ctx.kv.published)).not.toContain('9336124858');
    expect(ctx.sealRepo.ledger).toEqual([expect.objectContaining({ kind: 'seal', itemHash: row?.sealHash })]);
  });

  it('anyone can verify the seal offline with /.well-known/cachet-keys.json', async () => {
    const ctx = await setup();
    const body = (await (await ctx.seal()).json()) as Json;
    const keys = (await (await ctx.app.request('/.well-known/cachet-keys.json')).json()) as {
      keys: { kty: string; crv: string; x: string; kid: string }[];
    };
    const stored = JSON.parse(ctx.sealRepo.sealRows.get(String(body['sealId']))?.sealJson ?? '{}') as Seal;
    const jwk = keys.keys.find((k) => k.kid === stored.kid);
    expect(jwk).toBeDefined();
    expect(
      verifySealSignature(stored, publicKeyFromJwk(jwk as { kty: string; crv: string; x: string })),
    ).toBe(true);
    expect(verifySealSignature({ ...stored, code: '0001' }, publicKeyFromJwk(jwk as never))).toBe(false);
  });

  it('accepts an amount in the payment token', async () => {
    const ctx = await setup();
    const res = await ctx.seal(ctx.request({ amount: { value: '12.40', asset: 'EUDemo' } }));
    expect(res.status).toBe(201);
  });

  it('a new seal for the same person replaces the open one (one open seal per callee)', async () => {
    const ctx = await setup();
    const first = (await (await ctx.seal()).json()) as Json;
    const second = (await (await ctx.seal()).json()) as Json;
    expect(ctx.sealRepo.sealRows.get(String(first['sealId']))?.status).toBe('superseded');
    expect(ctx.sealRepo.sealRows.get(String(second['sealId']))?.status).toBe('open');
    const other = await ctx.seal(ctx.request({ to: '+919999999999' }));
    expect(other.status).toBe(201);
  });
});

describe('consent ("who may call me" in the bot)', () => {
  const PEPPER = 'test-phone-pepper-0123456789abcdef';

  it('a person who BLOCKED the company gets no seal, and no credit is spent', async () => {
    const ctx = await setup();
    const biz = await ctx.repo.findByAccount(ACCOUNT);
    await ctx.consentsRepo.set(phoneHash(PEPPER, CALLEE), biz?.id ?? '', 'revoked', new Date());
    const res = await ctx.seal();
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('consent_revoked');
    expect(await ctx.sealRepo.creditBalance(ctx.agentId)).toBe(10);
  });

  it('a person who ALLOWED the company gets seals that say consent: granted', async () => {
    const ctx = await setup();
    const biz = await ctx.repo.findByAccount(ACCOUNT);
    await ctx.consentsRepo.set(phoneHash(PEPPER, CALLEE), biz?.id ?? '', 'granted', new Date());
    const body = (await (await ctx.seal()).json()) as Json;
    const stored = JSON.parse(ctx.sealRepo.sealRows.get(String(body['sealId']))?.sealJson ?? '{}') as Seal;
    expect(stored.consent).toBe('granted');
  });

  it('no choice yet → consent: none_recorded (we never imply consent)', async () => {
    const ctx = await setup();
    const body = (await (await ctx.seal()).json()) as Json;
    const stored = JSON.parse(ctx.sealRepo.sealRows.get(String(body['sealId']))?.sealJson ?? '{}') as Seal;
    expect(stored.consent).toBe('none_recorded');
  });
});

describe('POST /v1/seals: refusals', () => {
  it('no credits → 402 and nothing stored', async () => {
    const ctx = await setup({}, 0);
    const res = await ctx.seal();
    expect(res.status).toBe(402);
    expect(await errorCode(res)).toBe('payment_required');
    expect(ctx.sealRepo.sealRows.size).toBe(0);
  });

  it('a replayed request is refused and charged only once', async () => {
    const ctx = await setup();
    const req = ctx.request();
    expect((await ctx.seal(req)).status).toBe(201);
    const again = await ctx.seal(req);
    expect(await errorCode(again)).toBe('seal_replay');
    expect(await ctx.sealRepo.creditBalance(ctx.agentId)).toBe(9);
  });

  it.each([
    ['2 minutes+ old', -121],
    ['from the future', 121],
  ])('a request %s is refused', async (_name, offset) => {
    const ctx = await setup();
    const res = await ctx.seal(ctx.request({ ts: Math.floor(ctx.clock.t / 1000) + offset }));
    expect(await errorCode(res)).toBe('seal_stale');
  });

  it('a bad signature is refused and does not burn the nonce', async () => {
    let good = false;
    const ctx = await setup({
      verifyAgentMessage: async () => (good ? { ok: true } : { ok: false, reason: 'bad_signature' }),
    });
    const req = ctx.request();
    const res = await ctx.seal(req);
    expect(res.status).toBe(401);
    good = true;
    expect((await ctx.seal(req)).status).toBe(201);
  });

  it('an unknown badge is refused', async () => {
    const ctx = await setup();
    expect(await errorCode(await ctx.seal(ctx.request({ badge: 'UnknownBadge123' })))).toBe('agent_unknown');
  });

  it("another account can't ask for this agent's seals", async () => {
    const ctx = await setup();
    expect(await errorCode(await ctx.seal(ctx.request({ agentAccount: OTHER_ACCOUNT })))).toBe(
      'agent_account_mismatch',
    );
  });

  it.each([
    ['revoked on chain', { status: 'Revoked' as const }, 'agent_revoked'],
    ['transferred to someone else', { owner: OTHER_ACCOUNT }, 'agent_revoked'],
    ['with no payment wallet', { agentWallet: null }, 'agent_revoked'],
    ['whose pinned card changed', { metadataHash: 'f'.repeat(64) }, 'agent_card_mismatch'],
  ])('an agent %s gets no seal', async (_name, change, code) => {
    const ctx = await setup();
    const live = ctx.chain.onChain.get(42n);
    if (!live) throw new Error('setup');
    ctx.chain.onChain.set(42n, { ...live, ...change });
    expect(await errorCode(await ctx.seal())).toBe(code);
  });

  it('an agent that disappeared from chain gets no seal', async () => {
    const ctx = await setup();
    ctx.chain.onChain.delete(42n);
    expect(await errorCode(await ctx.seal())).toBe('agent_revoked');
  });

  it('revocation on chain shows up within 15 seconds', async () => {
    const ctx = await setup();
    expect((await ctx.seal()).status).toBe(201);
    const live = ctx.chain.onChain.get(42n);
    if (!live) throw new Error('setup');
    ctx.chain.onChain.set(42n, { ...live, status: 'Revoked' });
    ctx.clock.t += 15_001;
    expect(await errorCode(await ctx.seal())).toBe('agent_revoked');
  });

  it('a suspended company gets no seal', async () => {
    const ctx = await setup();
    const biz = await ctx.repo.findByAccount(ACCOUNT);
    if (!biz) throw new Error('setup');
    // The in-memory repo returns the stored record, so this suspends the company.
    (biz as { status: string }).status = 'suspended';
    expect(await errorCode(await ctx.seal())).toBe('business_suspended');
  });

  it.each([
    ['a calling number not registered', { from: '+31209999999' }, 'number_not_allowed'],
    ['a purpose not registered', { purpose: 'delivery' }, 'purpose_not_allowed'],
    ['a link in the message', { message: 'Pay at https://evil.example now' }, 'message_not_allowed'],
    ['a bare domain in the message', { message: 'Visit northwind-pay.com today' }, 'message_not_allowed'],
    ['a phone number in the message', { message: 'Call us back on 9336 124 858' }, 'message_not_allowed'],
    ['a message over 80 characters', { message: 'x'.repeat(81) }, 'message_not_allowed'],
    ['an amount in another currency', { amount: { value: '12.40', asset: 'USDT' } }, 'amount_not_allowed'],
    ['a zero amount', { amount: { value: '0', asset: 'EUDemo' } }, 'amount_not_allowed'],
    ['a malformed amount', { amount: { value: '12,40', asset: 'EUDemo' } }, 'amount_not_allowed'],
    ['a callee number without country code', { to: '09336124858' }, 'invalid_phone'],
  ])('refuses %s', async (_name, over, code) => {
    const ctx = await setup();
    expect(await errorCode(await ctx.seal(ctx.request(over)))).toBe(code);
    expect(ctx.sealRepo.sealRows.size).toBe(0);
  });

  it('refuses unknown fields (the AI signs exactly what it sends)', async () => {
    const ctx = await setup();
    expect((await ctx.seal(ctx.request({ extra: 'x' }))).status).toBe(400);
  });

  it('refuses a malformed signature', async () => {
    const ctx = await setup();
    expect((await ctx.seal(ctx.request(), 'not-a-signature')).status).toBe(400);
  });
});

describe('closing a seal when the call ends', () => {
  it('closes the seal and records the closing for the on-chain ledger', async () => {
    const ctx = await setup();
    const issued = (await (await ctx.seal()).json()) as Json;
    const id = String(issued['sealId']);
    const res = await ctx.close(id);
    expect(res.status).toBe(200);
    expect(ctx.sealRepo.sealRows.get(id)?.status).toBe('closed');
    expect(ctx.sealRepo.ledger.map((l) => l.kind)).toEqual(['seal', 'seal_closed']);
    expect(ctx.checkedMessages.at(-1)?.message).toMatch(/^cachet:seal-close:v1:[0-9a-f]{64}$/);
    expect(ctx.checkedMessages.at(-1)?.message).toBe(
      sealCloseMessage(ctx.checkedMessages.at(-1)?.message.split(':').at(-1) ?? ''),
    );

    const view = (await (await ctx.app.request(`/v1/seals/${id}`)).json()) as Json;
    expect(view['status']).toBe('closed');
  });

  it('closing twice is refused', async () => {
    const ctx = await setup();
    const id = String(((await (await ctx.seal()).json()) as Json)['sealId']);
    await ctx.close(id);
    expect(await errorCode(await ctx.close(id))).toBe('seal_not_open');
  });

  it("another account can't close someone else's seal", async () => {
    const ctx = await setup();
    const id = String(((await (await ctx.seal()).json()) as Json)['sealId']);
    expect(await errorCode(await ctx.close(id, { agentAccount: OTHER_ACCOUNT }))).toBe('seal_not_found');
    expect(ctx.sealRepo.sealRows.get(id)?.status).toBe('open');
  });

  it('the seal id in the URL must match the signed request', async () => {
    const ctx = await setup();
    const id = String(((await (await ctx.seal()).json()) as Json)['sealId']);
    const other = String(
      ((await (await ctx.seal(ctx.request({ to: '+919999999999' }))).json()) as Json)['sealId'],
    );
    const res = await ctx.app.request(
      postJson(`/v1/seals/${id}/close`, {
        request: {
          v: 'cachet-seal-close/1',
          sealId: other,
          agentAccount: AGENT_ACCOUNT,
          reason: 'completed',
          nonce: randomBytes(16).toString('hex'),
          ts: Math.floor(ctx.clock.t / 1000),
        },
        signature: SIG,
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /v1/seals/:id (public, share-safe)', () => {
  it('shows company, agent and purpose, but never the call code or phone data', async () => {
    const ctx = await setup();
    const issued = (await (await ctx.seal()).json()) as Json;
    const res = await ctx.app.request(`/v1/seals/${String(issued['sealId'])}`);
    const view = (await res.json()) as Json;
    expect(view).toMatchObject({
      status: 'open',
      signatureValid: true,
      purpose: 'billing',
      message: 'Your November bill is ready',
      company: { legalName: 'Northwind Energy BV', legalCountry: 'NL' },
      agent: { name: 'Northwind billing assistant', tokenId: '42' },
      anchor: { status: 'pending' },
    });
    const text = JSON.stringify(view);
    expect(text).not.toContain(String(issued['code']).replace('-', ''));
    expect(text).not.toContain('hmac-sha256');
    expect(text).not.toContain('9336124858');
  });

  it('shows the live on-chain status of the AI caller and a link to check the badge independently', async () => {
    const ctx = await setup();
    const id = String(((await (await ctx.seal()).json()) as Json)['sealId']);
    const view = (await (await ctx.app.request(`/v1/seals/${id}`)).json()) as { agent: Json; company: Json };
    expect(view.agent).toMatchObject({
      onChain: 'active',
      badgeCheckUrl: 'https://registry.test/v1/check-badge/JyP9Badge42',
    });
    expect(view.company['status']).toBe('active');
  });

  it('says "switched_off" once the agent is revoked on chain (after the 15 s cache)', async () => {
    const ctx = await setup();
    const id = String(((await (await ctx.seal()).json()) as Json)['sealId']);
    const live = ctx.chain.onChain.get(42n);
    if (!live) throw new Error('setup');
    ctx.chain.onChain.set(42n, { ...live, status: 'Revoked' });
    ctx.clock.t += 15_001;
    const view = (await (await ctx.app.request(`/v1/seals/${id}`)).json()) as { agent: Json };
    expect(view.agent['onChain']).toBe('switched_off');
  });

  it('shows "expired" after 15 minutes', async () => {
    const ctx = await setup();
    const id = String(((await (await ctx.seal()).json()) as Json)['sealId']);
    ctx.clock.t += 15 * 60 * 1000 + 1;
    expect(((await (await ctx.app.request(`/v1/seals/${id}`)).json()) as Json)['status']).toBe('expired');
  });

  it('unknown or malformed ids → 404', async () => {
    const ctx = await setup();
    expect((await ctx.app.request('/v1/seals/01JD3K0000000000000000000Z')).status).toBe(404);
    expect((await ctx.app.request('/v1/seals/not-a-ulid')).status).toBe(404);
  });
});
