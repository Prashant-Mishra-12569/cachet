import { describe, expect, it } from 'vitest';
import { VerifierError } from '../../verify/verifier-client';
import {
  ACCOUNT,
  AUDIT_TX,
  OTHER_ACCOUNT,
  REQUEST_TX,
  companyPresentation,
  fakeVerifier,
  makeTestApp,
  postJson,
  signIn,
} from '../test-helpers';

type Json = Record<string, unknown>;
const errorCode = async (res: Response) => (((await res.json()) as Json)['error'] as Json)['code'];

async function startProof(app: ReturnType<typeof makeTestApp>['app'], cookie: string) {
  const res = await app.request(postJson('/v1/business/proof/request', {}, { cookie }));
  return { res, body: (await res.json()) as { proofId: string; request: Json } };
}

describe('business routes need a signed-in session', () => {
  it.each([
    ['GET', '/v1/business/me'],
    ['POST', '/v1/business/proof/request'],
    ['POST', '/v1/business/proof/verify'],
  ])('%s %s → 401 when not signed in', async (method, path) => {
    const { app } = makeTestApp();
    const res =
      method === 'GET'
        ? await app.request(path)
        : await app.request(postJson(path, { proofId: 'x', presentation: {} }));
    expect(res.status).toBe(401);
  });

  it('rejects a proof request from another website (CSRF)', async () => {
    const { app } = makeTestApp();
    const cookie = await signIn(app);
    const res = await app.request(
      postJson('/v1/business/proof/request', {}, { cookie, origin: 'https://evil.example' }),
    );
    expect(res.status).toBe(403);
  });

  it('/me shows no business before the company is proven', async () => {
    const { app } = makeTestApp();
    const cookie = await signIn(app);
    const body = (await (await app.request('/v1/business/me', { headers: { cookie } })).json()) as Json;
    expect(body).toEqual({ account: ACCOUNT, business: null });
  });
});

describe('POST /v1/business/proof/request', () => {
  it('asks for an account-based proof from the company identity provider, revealing name + country', async () => {
    const verifier = fakeVerifier();
    const { app } = makeTestApp({ verifier: verifier.client });
    const cookie = await signIn(app);
    const { res, body } = await startProof(app, cookie);

    expect(res.status).toBe(200);
    expect(body.proofId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.request['transactionRef']).toBe(REQUEST_TX);
    expect(verifier.calls.create[0]).toMatchObject({
      resourceId: 'cachet:company-proof',
      publicInfo: { app: 'cachet', purpose: 'company-proof' },
      requestedClaims: [
        {
          type: 'identity',
          source: ['accountCredential'],
          issuers: ['did:ccd:testnet:idp:4'],
          statements: [
            { type: 'RevealAttribute', attributeTag: 'legalName' },
            { type: 'RevealAttribute', attributeTag: 'legalCountry' },
          ],
        },
      ],
    });
    // Nothing personal goes on-chain with the request anchor.
    expect(JSON.stringify(verifier.calls.create[0]?.publicInfo)).not.toContain(ACCOUNT);
  });

  it('limits proof requests to 5 per account per 10 minutes (each one costs CCD)', async () => {
    const { app } = makeTestApp();
    const cookie = await signIn(app);
    for (let i = 0; i < 5; i++) expect((await startProof(app, cookie)).res.status).toBe(200);
    expect((await startProof(app, cookie)).res.status).toBe(429);
  });

  it('explains when the verifier service is down', async () => {
    const verifier = fakeVerifier();
    verifier.client.createRequest = async () => {
      throw new VerifierError('unreachable', 0);
    };
    const { app } = makeTestApp({ verifier: verifier.client });
    const cookie = await signIn(app);
    const { res } = await startProof(app, cookie);
    expect(res.status).toBe(503);
  });
});

describe('POST /v1/business/proof/verify', () => {
  async function prove(
    options: Parameters<typeof makeTestApp>[0] = {},
    presentation: unknown = companyPresentation(),
  ) {
    const ctx = makeTestApp(options);
    const cookie = await signIn(ctx.app);
    const { body } = await startProof(ctx.app, cookie);
    const res = await ctx.app.request(
      postJson('/v1/business/proof/verify', { proofId: body.proofId, presentation }, { cookie }),
    );
    return { ...ctx, cookie, proofId: body.proofId, res };
  }

  it('saves the company with the name and country FROM THE PROOF, plus on-chain links', async () => {
    const { res, repo, app, cookie } = await prove();
    expect(res.status).toBe(200);
    const business = ((await res.json()) as Json)['business'] as Json;
    expect(business).toMatchObject({
      legalName: 'Northwind Energy BV',
      legalCountry: 'NL',
      status: 'active',
      proofTx: AUDIT_TX,
      proofTxUrl: `https://ccdexplorer.io/testnet/transaction/${AUDIT_TX}`,
      requestTx: REQUEST_TX,
    });
    expect((await repo.findByAccount(ACCOUNT))?.legalName).toBe('Northwind Energy BV');

    const me = (await (await app.request('/v1/business/me', { headers: { cookie } })).json()) as Json;
    expect((me['business'] as Json)['legalName']).toBe('Northwind Energy BV');
  });

  it('verifies against the request the SERVER stored, not one sent by the browser', async () => {
    const verifier = fakeVerifier();
    const ctx = makeTestApp({ verifier: verifier.client });
    const cookie = await signIn(ctx.app);
    const { body } = await startProof(ctx.app, cookie);
    await ctx.app.request(
      postJson(
        '/v1/business/proof/verify',
        {
          proofId: body.proofId,
          presentation: companyPresentation(),
          verificationRequest: { type: 'ConcordiumVerificationRequestV1', transactionRef: 'evil' },
        },
        { cookie },
      ),
    );
    expect(verifier.calls.verify[0]?.verificationRequest.transactionRef).toBe(REQUEST_TX);
    expect(verifier.calls.verify[0]?.auditRecordId).toBe(body.proofId);
  });

  it('refuses a proof from a different account than the signed-in one', async () => {
    const { res, repo } = await prove({ accountOfCredential: async () => OTHER_ACCOUNT });
    expect(await errorCode(res)).toBe('proof_wrong_account');
    expect(await repo.findByAccount(ACCOUNT)).toBeNull();
  });

  it('refuses a credential nobody owns on chain', async () => {
    const { res } = await prove({ accountOfCredential: async () => null });
    expect(await errorCode(res)).toBe('proof_wrong_account');
  });

  it('refuses a personal identity (issuer is not a company identity provider)', async () => {
    const { res } = await prove({}, companyPresentation({ issuer: 'did:ccd:testnet:idp:0' }));
    expect(await errorCode(res)).toBe('proof_not_company');
  });

  it.each([
    ['empty name', { legalName: '  ' }],
    ['name over 200 chars', { legalName: 'x'.repeat(201) }],
    ['country not ISO alpha-2', { legalCountry: 'Netherlands' }],
  ])('refuses %s', async (_name, overrides) => {
    const { res } = await prove({}, companyPresentation(overrides));
    expect(await errorCode(res)).toBe('proof_not_company');
  });

  it('refuses a presentation with two credentials', async () => {
    const p = companyPresentation();
    p.verifiableCredential.push(...companyPresentation().verifiableCredential);
    const { res } = await prove({}, p);
    expect(await errorCode(res)).toBe('proof_invalid');
  });

  it('refuses when the verifier says the proof failed', async () => {
    const verifier = fakeVerifier({
      verify: async () => ({ result: { failed: { code: 'InvalidProof', message: 'bad proof' } } }),
    });
    const { res, repo } = await prove({ verifier: verifier.client });
    expect(await errorCode(res)).toBe('proof_failed');
    expect(await repo.findByAccount(ACCOUNT)).toBeNull();
  });

  it('refuses when the verifier gives no on-chain audit anchor', async () => {
    const verifier = fakeVerifier({
      verify: async () => ({ result: 'verified', anchorTransactionHash: null }),
    });
    const { res } = await prove({ verifier: verifier.client }, companyPresentation());
    expect(await errorCode(res)).toBe('proof_failed');
  });

  it('a proof request can be used only once', async () => {
    const { app, cookie, proofId } = await prove();
    const again = await app.request(
      postJson('/v1/business/proof/verify', { proofId, presentation: companyPresentation() }, { cookie }),
    );
    expect(await errorCode(again)).toBe('proof_expired');
  });

  it('a proof request started by one account cannot be finished by another', async () => {
    const { app } = makeTestApp();
    const cookieA = await signIn(app, ACCOUNT);
    const { body } = await startProof(app, cookieA);
    const cookieB = await signIn(app, OTHER_ACCOUNT);
    const res = await app.request(
      postJson(
        '/v1/business/proof/verify',
        { proofId: body.proofId, presentation: companyPresentation() },
        { cookie: cookieB },
      ),
    );
    expect(await errorCode(res)).toBe('proof_expired');
  });

  it('a proof request expires after 10 minutes', async () => {
    const { app, clock } = makeTestApp();
    const cookie = await signIn(app);
    const { body } = await startProof(app, cookie);
    clock.t += 10 * 60 * 1000 + 1;
    const res = await app.request(
      postJson(
        '/v1/business/proof/verify',
        { proofId: body.proofId, presentation: companyPresentation() },
        { cookie },
      ),
    );
    // The 8-hour session is still valid; only the 10-minute proof request has expired.
    expect(await errorCode(res)).toBe('proof_expired');
  });

  it('a SUSPENDED company cannot start fresh by proving itself from another account', async () => {
    const ctx = makeTestApp();
    const p = companyPresentation();
    // The same legal company, proven earlier from another account and suspended after reports.
    const old = await ctx.repo.upsertVerified({
      concordiumAccount: OTHER_ACCOUNT,
      legalName: 'Northwind Energy BV',
      legalCountry: 'NL',
      issuer: 'did:ccd:testnet:idp:4',
      proofTx: 'a'.repeat(64),
      requestTx: 'b'.repeat(64),
      verifiedAt: new Date(),
    });
    await ctx.repo.setStatus(old.id, 'suspended', 'reports', new Date());
    const cookie = await signIn(ctx.app);
    const { body } = await startProof(ctx.app, cookie);
    const res = await ctx.app.request(
      postJson('/v1/business/proof/verify', { proofId: body.proofId, presentation: p }, { cookie }),
    );
    expect(await errorCode(res)).toBe('proof_company_suspended');
    expect(await ctx.repo.findByAccount(ACCOUNT)).toBeNull();
  });

  it('proving again updates the company details', async () => {
    const ctx = makeTestApp();
    const cookie = await signIn(ctx.app);
    for (const legalName of ['Old Name BV', 'New Name BV']) {
      const { body } = await startProof(ctx.app, cookie);
      await ctx.app.request(
        postJson(
          '/v1/business/proof/verify',
          { proofId: body.proofId, presentation: companyPresentation({ legalName }) },
          { cookie },
        ),
      );
    }
    expect((await ctx.repo.findByAccount(ACCOUNT))?.legalName).toBe('New Name BV');
  });

  it('rejects an oversized body', async () => {
    const { app } = makeTestApp();
    const cookie = await signIn(app);
    const res = await app.request(
      postJson(
        '/v1/business/proof/verify',
        { proofId: 'x', presentation: { junk: 'x'.repeat(300 * 1024) } },
        { cookie },
      ),
    );
    expect(res.status).toBe(400);
  });

  it('origin header is required on verify too', async () => {
    const { app } = makeTestApp();
    const cookie = await signIn(app);
    const res = await app.request(
      new Request('http://localhost/v1/business/proof/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ proofId: 'x', presentation: {} }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
