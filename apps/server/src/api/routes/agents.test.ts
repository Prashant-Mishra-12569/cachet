import { describe, expect, it } from 'vitest';
import { CACHET_EXTENSION_URI, sha256Hex } from '../../agents/card';
import { createMemoryCardHost } from '../../agents/card-host';
import {
  ACCOUNT,
  AUDIT_TX,
  OTHER_ACCOUNT,
  makeTestApp,
  postJson,
  signIn,
  signInAsCompany,
} from '../test-helpers';

type Json = Record<string, unknown>;
const AGENT_ACCOUNT = '33Rcud5xa7UZT3JQawDw9rhp5X14H8MPmfGR9E1uHQ59mr1jVq';
const TX1 = '1'.repeat(64);
const TX2 = '2'.repeat(64);
const TX3 = '3'.repeat(64);

const newAgent = (over: Json = {}) => ({
  name: 'Northwind billing assistant',
  description: 'Calls customers about their electricity bills.',
  purposes: ['billing', 'support'],
  language: 'en',
  callingNumbers: ['+31201234567'],
  agentAccount: AGENT_ACCOUNT,
  ...over,
});

const errorCode = async (res: Response) => (((await res.json()) as Json)['error'] as Json)['code'];

async function setup(options: Parameters<typeof makeTestApp>[0] = {}) {
  const ctx = makeTestApp(options);
  const cookie = await signInAsCompany(ctx.app);
  const post = (path: string, body: unknown = {}) => ctx.app.request(postJson(path, body, { cookie }));
  const create = async (over: Json = {}) => {
    const res = await post('/v1/agents', newAgent(over));
    // Read a copy, so tests can still read `res` themselves.
    return { res, agent: ((await res.clone().json()) as Json)['agent'] as Json };
  };
  return { ...ctx, cookie, post, create };
}

/** Run register → confirm and return the agent view. */
async function registered(ctx: Awaited<ReturnType<typeof setup>>, tokenId = 42n) {
  const { agent } = await ctx.create();
  ctx.chain.registerTx(TX1, ACCOUNT, tokenId);
  const res = await ctx.post(`/v1/agents/${String(agent['id'])}/register/confirm`, { txHash: TX1 });
  return ((await res.json()) as Json)['agent'] as Json;
}

describe('AI callers need a verified company', () => {
  it('a signed-in account without a proven company gets 403', async () => {
    const { app } = makeTestApp();
    const cookie = await signIn(app);
    expect((await app.request('/v1/agents', { headers: { cookie } })).status).toBe(403);
    const res = await app.request(postJson('/v1/agents', newAgent(), { cookie }));
    expect(await errorCode(res)).toBe('business_not_verified');
  });

  it('not signed in → 401', async () => {
    const { app } = makeTestApp();
    expect((await app.request('/v1/agents')).status).toBe(401);
  });
});

describe('POST /v1/agents (add your AI caller)', () => {
  it('creates a draft with the details given', async () => {
    const { res, agent } = await (await setup()).create();
    expect(res.status).toBe(201);
    expect(agent).toMatchObject({
      status: 'draft',
      purposes: ['billing', 'support'],
      callingNumbers: ['+31201234567'],
      agentAccount: AGENT_ACCOUNT,
      tokenId: null,
    });
  });

  it.each([
    ['a number not in E.164 form', { callingNumbers: ['020 123 4567'] }],
    ['no numbers', { callingNumbers: [] }],
    ['an unknown purpose', { purposes: ['marketing'] }],
    ['no purpose', { purposes: [] }],
    ['an empty name', { name: '   ' }],
    ['a 3-letter language', { language: 'eng' }],
  ])('rejects %s', async (_name, over) => {
    const { res } = await (await setup()).create(over);
    expect(res.status).toBe(400);
  });

  it('rejects an AI account address whose checksum is wrong', async () => {
    const { res } = await (
      await setup()
    ).create({ agentAccount: '35sHhKDcJHrrHSgvFpsYxqb6g97uaQTd2kE31rPUeDZTeDsjVq' });
    expect(await errorCode(res)).toBe('invalid_account');
  });

  it('a phone number can belong to only one AI caller', async () => {
    const ctx = await setup();
    await ctx.create();
    const { res } = await ctx.create({ callingNumbers: ['+31201234567', '+31209999999'] });
    expect(await errorCode(res)).toBe('number_in_use');
  });

  it("an AI account can belong to only one live AI caller (no company can take another's)", async () => {
    const ctx = await setup();
    await ctx.create();
    const { res } = await ctx.create({ callingNumbers: ['+31209999999'] });
    expect(await errorCode(res)).toBe('agent_account_in_use');
  });

  it('removes duplicate numbers', async () => {
    const { agent } = await (await setup()).create({ callingNumbers: ['+31201234567', '+31201234567'] });
    expect(agent['callingNumbers']).toEqual(['+31201234567']);
  });
});

describe('register on Concordium (step 3)', () => {
  it('prepare returns the register transaction for the wallet', async () => {
    const ctx = await setup();
    const { agent } = await ctx.create();
    const res = await ctx.post(`/v1/agents/${String(agent['id'])}/register/prepare`);
    const tx = ((await res.json()) as Json)['walletTx'] as Json;
    expect(tx).toMatchObject({ receiveName: 'CIS-8004.register', contract: { index: 12802, subindex: 0 } });
    expect(typeof tx['schemaBase64']).toBe('string');
  });

  it('confirm records token id, badge and the payment wallet (= the company) from the chain', async () => {
    const agent = await registered(await setup(), 42n);
    expect(agent).toMatchObject({
      status: 'registered',
      tokenId: '42',
      badge: 'JyP9Badge42',
      agentWallet: ACCOUNT,
      registerTxUrl: `https://ccdexplorer.io/testnet/transaction/${TX1}`,
      badgeCheckUrl: 'https://registry.test/v1/check-badge/JyP9Badge42',
    });
  });

  it('refuses a transaction sent by someone else', async () => {
    const ctx = await setup();
    const { agent } = await ctx.create();
    ctx.chain.registerTx(TX1, OTHER_ACCOUNT, 1n);
    const res = await ctx.post(`/v1/agents/${String(agent['id'])}/register/confirm`, { txHash: TX1 });
    expect(await errorCode(res)).toBe('tx_mismatch');
  });

  it('refuses a transaction that called a different function', async () => {
    const ctx = await setup();
    const { agent } = await ctx.create();
    ctx.chain.addTx(TX1, { sender: ACCOUNT, receiveName: 'CIS-8004.setAgentURI', events: [] });
    const res = await ctx.post(`/v1/agents/${String(agent['id'])}/register/confirm`, { txHash: TX1 });
    expect(await errorCode(res)).toBe('tx_mismatch');
  });

  it('refuses a register where the minted agent belongs to someone else', async () => {
    const ctx = await setup();
    const { agent } = await ctx.create();
    ctx.chain.addTx(TX1, {
      sender: ACCOUNT,
      receiveName: 'CIS-8004.register',
      events: [{ type: 'Registered', tokenId: 5n, owner: OTHER_ACCOUNT, agentUri: null, metadataHash: null }],
    });
    const res = await ctx.post(`/v1/agents/${String(agent['id'])}/register/confirm`, { txHash: TX1 });
    expect(await errorCode(res)).toBe('tx_mismatch');
  });

  it('a failed transaction changes nothing', async () => {
    const ctx = await setup();
    const { agent } = await ctx.create();
    ctx.chain.addTx(TX1, { sender: ACCOUNT, receiveName: 'CIS-8004.register', events: [], failed: true });
    const res = await ctx.post(`/v1/agents/${String(agent['id'])}/register/confirm`, { txHash: TX1 });
    expect(await errorCode(res)).toBe('tx_failed');
    expect([...ctx.agentRepo.rows.values()][0]?.status).toBe('draft');
  });

  it('an unknown transaction hash says "try again in a moment"', async () => {
    const ctx = await setup();
    const { agent } = await ctx.create();
    const res = await ctx.post(`/v1/agents/${String(agent['id'])}/register/confirm`, { txHash: TX1 });
    expect(await errorCode(res)).toBe('tx_not_found');
  });

  it('the same transaction cannot register two AI callers', async () => {
    const ctx = await setup();
    await registered(ctx, 42n);
    const { agent: second } = await ctx.create({
      callingNumbers: ['+31209999999'],
      agentAccount: OTHER_ACCOUNT, // each AI caller has its own account
    });
    const res = await ctx.post(`/v1/agents/${String(second['id'])}/register/confirm`, { txHash: TX1 });
    expect(await errorCode(res)).toBe('tx_already_used');
  });

  it('confirming twice is refused (already registered)', async () => {
    const ctx = await setup();
    const agent = await registered(ctx);
    const res = await ctx.post(`/v1/agents/${String(agent['id'])}/register/confirm`, { txHash: TX1 });
    expect(await errorCode(res)).toBe('agent_wrong_state');
  });

  it('rejects a malformed transaction hash', async () => {
    const ctx = await setup();
    const { agent } = await ctx.create();
    const res = await ctx.post(`/v1/agents/${String(agent['id'])}/register/confirm`, { txHash: 'xyz' });
    expect(res.status).toBe(400);
  });
});

describe('Agent Card + setAgentURI (step 4)', () => {
  it('publishes a card with the Concordium badge AND Cachet section, served byte-for-byte', async () => {
    const ctx = await setup();
    const agent = await registered(ctx, 42n);
    const res = await ctx.post(`/v1/agents/${String(agent['id'])}/card/prepare`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agent: Json; walletTx: Json };

    const url = String(body.agent['agentUri']);
    const served = (ctx.cardHost as ReturnType<typeof createMemoryCardHost>).served.get(url) ?? '';
    expect(sha256Hex(served)).toBe(body.agent['metadataHash']);

    const card = JSON.parse(served) as {
      url: string;
      capabilities: { extensions: { uri: string; params: Json }[] };
    };
    expect(card.url).toBe(url);
    const uris = card.capabilities.extensions.map((e) => e.uri);
    expect(uris).toContain('https://docs.concordium.com/a2a-extensions/concordium-badge/v1');
    const cachet = card.capabilities.extensions.find((e) => e.uri === CACHET_EXTENSION_URI);
    expect(cachet?.params).toMatchObject({
      version: 1,
      company: { legalName: 'Northwind Energy BV', legalCountry: 'NL', proofTx: AUDIT_TX },
      purposes: ['billing', 'support'],
      callingNumbers: ['+31201234567'],
      agentAccount: `ccd:4221332d34e1694168c2a0c0b3fd0f27:${AGENT_ACCOUNT}`,
      neverCalls: false,
    });

    expect(body.walletTx).toMatchObject({
      receiveName: 'CIS-8004.setAgentURI',
      parameterJson: { token_id: '42', agent_uri: url, metadata_hash: body.agent['metadataHash'] },
    });
  });

  it('confirm makes the agent active when the chain pinned exactly our URL + hash', async () => {
    const ctx = await setup();
    const agent = await registered(ctx, 42n);
    const prepared = (await (await ctx.post(`/v1/agents/${String(agent['id'])}/card/prepare`)).json()) as {
      agent: Json;
    };
    ctx.chain.setUriTx(
      TX2,
      ACCOUNT,
      42n,
      String(prepared.agent['agentUri']),
      String(prepared.agent['metadataHash']),
    );
    const res = await ctx.post(`/v1/agents/${String(agent['id'])}/card/confirm`, { txHash: TX2 });
    const done = ((await res.json()) as Json)['agent'] as Json;
    expect(done).toMatchObject({
      status: 'active',
      cardTxUrl: `https://ccdexplorer.io/testnet/transaction/${TX2}`,
    });

    const badge = await ctx.app.request(`/v1/agents/${String(agent['id'])}/badge`, {
      headers: { cookie: ctx.cookie },
    });
    expect(((await badge.json()) as { badge: Json }).badge['badge_valid']).toBe(true);
  });

  it('refuses a setAgentURI that pinned a different hash', async () => {
    const ctx = await setup();
    const agent = await registered(ctx, 42n);
    const prepared = (await (await ctx.post(`/v1/agents/${String(agent['id'])}/card/prepare`)).json()) as {
      agent: Json;
    };
    ctx.chain.setUriTx(TX2, ACCOUNT, 42n, String(prepared.agent['agentUri']), 'f'.repeat(64));
    const res = await ctx.post(`/v1/agents/${String(agent['id'])}/card/confirm`, { txHash: TX2 });
    expect(await errorCode(res)).toBe('tx_mismatch');
  });

  it('refuses a setAgentURI for a different token', async () => {
    const ctx = await setup();
    const agent = await registered(ctx, 42n);
    const prepared = (await (await ctx.post(`/v1/agents/${String(agent['id'])}/card/prepare`)).json()) as {
      agent: Json;
    };
    ctx.chain.setUriTx(
      TX3,
      ACCOUNT,
      43n,
      String(prepared.agent['agentUri']),
      String(prepared.agent['metadataHash']),
    );
    const res = await ctx.post(`/v1/agents/${String(agent['id'])}/card/confirm`, { txHash: TX3 });
    expect(await errorCode(res)).toBe('tx_mismatch');
  });

  it('cannot publish a card before the agent is registered', async () => {
    const ctx = await setup();
    const { agent } = await ctx.create();
    const res = await ctx.post(`/v1/agents/${String(agent['id'])}/card/prepare`);
    expect(await errorCode(res)).toBe('agent_wrong_state');
  });

  it('explains when no card host is configured', async () => {
    const ctx = await setup({ cardHost: null });
    const agent = await registered(ctx);
    const res = await ctx.post(`/v1/agents/${String(agent['id'])}/card/prepare`);
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe('card_host_unavailable');
  });

  it('stops if the public URL does not serve exactly our bytes', async () => {
    const host = createMemoryCardHost();
    const realWrite = host.reserve.bind(host);
    host.reserve = async (label) => {
      const slot = await realWrite(label);
      return { url: slot.url, write: async (c) => slot.write(`${c}\n`) }; // a host that adds a newline
    };
    const ctx = await setup({ cardHost: host });
    const agent = await registered(ctx);
    const res = await ctx.post(`/v1/agents/${String(agent['id'])}/card/prepare`);
    expect(await errorCode(res)).toBe('card_not_served');
  });
});

describe('isolation between businesses', () => {
  it("one company cannot see or touch another company's AI caller", async () => {
    let owner = ACCOUNT;
    const ctx = makeTestApp({ accountOfCredential: async () => owner });
    const cookieA = await signInAsCompany(ctx.app, ACCOUNT);
    const created = (await (
      await ctx.app.request(postJson('/v1/agents', newAgent(), { cookie: cookieA }))
    ).json()) as { agent: Json };

    owner = OTHER_ACCOUNT;
    const cookieB = await signInAsCompany(ctx.app, OTHER_ACCOUNT);
    const list = (await (await ctx.app.request('/v1/agents', { headers: { cookie: cookieB } })).json()) as {
      agents: unknown[];
    };
    expect(list.agents).toEqual([]);
    const res = await ctx.app.request(
      postJson(`/v1/agents/${String(created.agent['id'])}/register/prepare`, {}, { cookie: cookieB }),
    );
    expect(await errorCode(res)).toBe('agent_not_found');
  });

  it('a non-UUID agent id is just "not found"', async () => {
    const ctx = await setup();
    const res = await ctx.post('/v1/agents/not-a-uuid/register/prepare');
    expect(res.status).toBe(404);
  });
});
