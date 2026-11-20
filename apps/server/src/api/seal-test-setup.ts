import { randomBytes } from 'node:crypto';
import { ACCOUNT, makeTestApp, postJson, signInAsCompany } from './test-helpers';

export type Json = Record<string, unknown>;
export const AGENT_ACCOUNT = '33Rcud5xa7UZT3JQawDw9rhp5X14H8MPmfGR9E1uHQ59mr1jVq';
export const CALLEE = '+919336124858';
export const SIG = { 0: { 0: 'ab'.repeat(64) } };
/** The phone pepper makeTestApp uses. */
export const TEST_PEPPER = 'test-phone-pepper-0123456789abcdef';

export const errorCode = async (res: Response) =>
  (((await res.clone().json()) as Json)['error'] as Json)['code'];

/** A verified company with one fully active AI caller (token 42), on chain and in Cachet. */
export async function setupSealing(options: Parameters<typeof makeTestApp>[0] = {}, credits = 10) {
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
