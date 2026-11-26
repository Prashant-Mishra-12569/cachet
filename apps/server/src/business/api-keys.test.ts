import { describe, expect, it } from 'vitest';
import { makeTestApp, postJson, signIn, signInAsCompany } from '../api/test-helpers';
import { createApiKeys, createMemoryApiKeyRepo, hashApiKey } from './api-keys';
import { createDashboard, type DashboardSource } from './dashboard';

type Json = Record<string, unknown>;

const zero = {
  total: 0,
  answered: 0,
  notAnswered: 0,
  failed: 0,
  cancelled: 0,
  blocked: 0,
  replaced: 0,
  inProgress: 0,
  expired: 0,
};
const source: DashboardSource = {
  counts: async () => ({ ...zero, total: 3, answered: 2, notAnswered: 1 }),
  perDay: async () => [],
  payments: async () => [],
  consents: async () => ({ granted: 0, revoked: 0 }),
  reports: async () => [],
  credits: async () => 50,
  invited: async () => 0,
  impersonations: async () => 0,
  recorded: async () => ({ sealed: 3, inRecord: 3 }),
  calls: async () => [],
  records: async () => [],
  agents: async () => [],
};

function setup() {
  const repo = createMemoryApiKeyRepo();
  const apiKeys = createApiKeys({ repo });
  const dashboard = createDashboard({ source, network: 'testnet', webOrigin: 'https://getcachet.site' });
  const ctx = makeTestApp({ apiKeys, dashboard });
  return { ...ctx, repo };
}

async function makeKey(t: ReturnType<typeof setup>, cookie: string, name = 'Billing system') {
  const res = await t.app.request(postJson('/v1/business/api-keys', { name }, { cookie }));
  return { res, body: (await res.json()) as { key: string; apiKey: Json } };
}

describe('read-only API keys', () => {
  it('a company makes a key: shown once, stored only as a hash', async () => {
    const t = setup();
    const cookie = await signInAsCompany(t.app);
    const { res, body } = await makeKey(t, cookie);
    expect(res.status).toBe(201);
    expect(body.key).toMatch(/^cachet_ro_[A-Za-z0-9_-]{43}$/);
    expect(body.apiKey).toMatchObject({
      name: 'Billing system',
      prefix: body.key.slice(0, 14),
      revokedAt: null,
    });
    const stored = JSON.stringify([...t.repo.rows.values()]);
    expect(stored).not.toContain(body.key);
    expect(stored).toContain(hashApiKey(body.key));
    const list = (await (await t.app.request('/v1/business/api-keys', { headers: { cookie } })).json()) as {
      apiKeys: Json[];
    };
    expect(JSON.stringify(list)).not.toContain(body.key); // never shown again
  });

  it('the key opens the data API, read-only, for its own company only', async () => {
    const t = setup();
    const cookie = await signInAsCompany(t.app);
    const { body } = await makeKey(t, cookie);
    const auth = { authorization: `Bearer ${body.key}` };
    const summary = await t.app.request('/v1/data/summary', { headers: auth });
    expect(summary.status).toBe(200);
    expect(((await summary.json()) as { calls: { total: number } }).calls.total).toBe(3);
    expect(
      (await t.app.request('/v1/data/calls?from=2026-11-01&to=2026-11-19', { headers: auth })).status,
    ).toBe(200);
    expect(
      (await t.app.request('/v1/data/calls.csv', { headers: auth })).headers.get('content-type'),
    ).toContain('text/csv');
    // Nothing can be changed with a key: no write routes exist.
    expect((await t.app.request(postJson('/v1/data/summary', {}, auth))).status).toBe(404);
  });

  it('no key, a made-up key, or a revoked key: refused', async () => {
    const t = setup();
    const cookie = await signInAsCompany(t.app);
    const { body } = await makeKey(t, cookie);
    expect((await t.app.request('/v1/data/summary')).status).toBe(401);
    const fake = `cachet_ro_${'A'.repeat(43)}`;
    expect(
      (await t.app.request('/v1/data/summary', { headers: { authorization: `Bearer ${fake}` } })).status,
    ).toBe(401);
    const id = String(body.apiKey['id']);
    expect((await t.app.request(postJson(`/v1/business/api-keys/${id}/revoke`, {}, { cookie }))).status).toBe(
      200,
    );
    const after = await t.app.request('/v1/data/summary', {
      headers: { authorization: `Bearer ${body.key}` },
    });
    expect(after.status).toBe(401);
  });

  it('only a proven company can make keys; at most 10 active', async () => {
    const t = setup();
    const notCompany = await signIn(t.app);
    expect((await makeKey(t, notCompany)).res.status).toBe(403);
    const cookie = await signInAsCompany(t.app);
    for (let i = 0; i < 10; i++) expect((await makeKey(t, cookie, `k${i}`)).res.status).toBe(201);
    expect((await makeKey(t, cookie, 'one too many')).res.status).toBe(409);
  });

  it('managing keys needs the website session (an API key cannot make more keys)', async () => {
    const t = setup();
    const cookie = await signInAsCompany(t.app);
    const { body } = await makeKey(t, cookie);
    const res = await t.app.request(
      postJson('/v1/business/api-keys', { name: 'sneaky' }, { authorization: `Bearer ${body.key}` }),
    );
    expect(res.status).toBe(401);
  });
});

describe('customer invite', () => {
  it('the company gets one stable invite code and the number of customers who joined', async () => {
    const t = setup();
    const cookie = await signInAsCompany(t.app);
    const a = (await (await t.app.request('/v1/business/invite', { headers: { cookie } })).json()) as Json;
    const b = (await (await t.app.request('/v1/business/invite', { headers: { cookie } })).json()) as Json;
    expect(a['code']).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(b['code']).toBe(a['code']);
    expect(a['joined']).toBe(0);
  });
});
