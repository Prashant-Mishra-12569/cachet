import { describe, expect, it } from 'vitest';
import { errorCode, setupSealing, type Json } from '../seal-test-setup';
import { ACCOUNT, postJson, signInAsCompany } from '../test-helpers';

const NEW_NUMBER = '+918035735856';
const TX = '7'.repeat(64);
const OTHER_TX = '8'.repeat(64);

async function setup() {
  const ctx = await setupSealing();
  const cookie = await signInAsCompany(ctx.app);
  const post = (path: string, body: unknown = {}) => ctx.app.request(postJson(path, body, { cookie }));
  const prepare = async (numbers: string[]) =>
    post(`/v1/agents/${ctx.agentId}/numbers/prepare`, { callingNumbers: numbers });
  return { ...ctx, post, prepare };
}

describe("changing an active AI caller's calling numbers", () => {
  it('staging changes nothing live: old numbers keep sealing until the company pins the new card', async () => {
    const t = await setup();
    const before = t.agentRepo.rows.get(t.agentId);
    const res = await t.prepare([NEW_NUMBER]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agent: Json; walletTx: Json };
    expect(body.agent['callingNumbers']).toEqual(['+31201234567']);
    expect(body.agent['pendingCallingNumbers']).toEqual([NEW_NUMBER]);
    expect(body.walletTx['receiveName']).toBe('CIS-8004.setAgentURI');
    // The live card fingerprint is unchanged → seals from the old number still work.
    expect(t.agentRepo.rows.get(t.agentId)?.metadataHash).toBe(before?.metadataHash);
    expect((await t.seal()).status).toBe(201);
    // The new number isn't valid yet.
    expect(await errorCode(await t.seal(t.request({ from: NEW_NUMBER })))).toBe('number_not_allowed');
  });

  it('after the on-chain pin: new numbers in force, and the card on chain matches', async () => {
    const t = await setup();
    const prepared = (await (await t.prepare([NEW_NUMBER])).json()) as { agent: Json };
    const pending = t.agentRepo.rows.get(t.agentId)?.pendingCard;
    if (!pending) throw new Error('no pending card');
    t.chain.setUriTx(TX, ACCOUNT, 42n, pending.agentUri, pending.metadataHash);
    const res = await t.post(`/v1/agents/${t.agentId}/numbers/confirm`, { txHash: TX });
    expect(res.status).toBe(200);
    const agent = ((await res.json()) as { agent: Json }).agent;
    expect(agent).toMatchObject({ callingNumbers: [NEW_NUMBER], pendingCallingNumbers: null });
    expect(agent['metadataHash']).toBe(pending.metadataHash);
    expect(prepared.agent['status']).toBe('active');

    // The chain now carries the new card too (what Concordium would show after the tx).
    const live = t.chain.onChain.get(42n);
    if (live)
      t.chain.onChain.set(42n, { ...live, agentUri: pending.agentUri, metadataHash: pending.metadataHash });
    t.clock.t += 20_000; // past the short on-chain cache
    expect((await t.seal(t.request({ from: NEW_NUMBER }))).status).toBe(201);
    expect(await errorCode(await t.seal(t.request({ from: '+31201234567' })))).toBe('number_not_allowed');
  });

  it('a transaction that pinned something else changes nothing', async () => {
    const t = await setup();
    await t.prepare([NEW_NUMBER]);
    t.chain.setUriTx(OTHER_TX, ACCOUNT, 42n, 'https://evil.example/card.json', 'f'.repeat(64));
    const res = await t.post(`/v1/agents/${t.agentId}/numbers/confirm`, { txHash: OTHER_TX });
    expect(await errorCode(res)).toBe('tx_mismatch');
    expect(t.agentRepo.rows.get(t.agentId)?.callingNumbers).toEqual(['+31201234567']);
  });

  it('confirm without a prepared update, or bad numbers → refused', async () => {
    const t = await setup();
    expect(await errorCode(await t.post(`/v1/agents/${t.agentId}/numbers/confirm`, { txHash: TX }))).toBe(
      'agent_wrong_state',
    );
    expect((await t.prepare(['12345'])).status).toBe(400);
    expect((await t.prepare([])).status).toBe(400);
  });
});
