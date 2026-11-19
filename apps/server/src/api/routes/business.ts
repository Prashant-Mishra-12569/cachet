import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { explorerTxUrl, type Network } from '@cachet/shared';
import type { AuthService } from '../../auth/service';
import { ProofError, type CompanyProofService } from '../../business/company-proof';
import type { BusinessRecord, BusinessRepo } from '../../business/repo';
import type { KvStore } from '../../infra/kv';
import { VerifierError } from '../../verify/verifier-client';
import { apiError } from '../errors';
import { rateLimit, requireSameOrigin, requireSession, type SessionEnv } from '../middleware';

export interface BusinessRouteDeps {
  auth: AuthService;
  kv: KvStore;
  repo: BusinessRepo;
  companyProof: CompanyProofService;
  network: Network;
  webOrigin: string;
  secureCookies: boolean;
  trustProxy: boolean;
}

const VerifyBody = z.object({
  proofId: z.string().min(1).max(100),
  presentation: z.record(z.string(), z.unknown()),
});

/** What the website sees about a business. */
function toView(b: BusinessRecord, network: Network) {
  return {
    legalName: b.legalName,
    legalCountry: b.legalCountry,
    status: b.status,
    neverCalls: b.neverCalls,
    verifiedAt: b.verifiedAt.toISOString(),
    proofTx: b.proofTx,
    proofTxUrl: explorerTxUrl(network, b.proofTx),
    requestTx: b.requestTx,
    requestTxUrl: explorerTxUrl(network, b.requestTx),
  };
}

export function businessRoutes(deps: BusinessRouteDeps) {
  const app = new Hono<SessionEnv>();
  app.use('*', requireSameOrigin(deps.webOrigin));
  app.use('*', requireSession(deps.auth, deps.secureCookies));

  /** The signed-in account's verified company, or null if it hasn't proved one yet. */
  app.get('/me', async (c) => {
    const business = await deps.repo.findByAccount(c.var.account);
    c.header('Cache-Control', 'no-store');
    return c.json({ account: c.var.account, business: business ? toView(business, deps.network) : null });
  });

  /**
   * Start a company proof. Each call writes an anchor on-chain and costs CCD, so it is limited
   * per account AND per IP.
   */
  app.post(
    '/proof/request',
    rateLimit({
      kv: deps.kv,
      name: 'proof-req-ip',
      limit: 10,
      windowSeconds: 600,
      trustProxy: deps.trustProxy,
    }),
    rateLimit({
      kv: deps.kv,
      name: 'proof-req-acct',
      limit: 5,
      windowSeconds: 600,
      trustProxy: deps.trustProxy,
      byAccount: true,
    }),
    async (c) => {
      try {
        return c.json(await deps.companyProof.start(c.var.account));
      } catch (err) {
        if (err instanceof VerifierError) {
          console.error('[proof] verifier error on request:', err.status, err.code ?? '', err.message);
          return apiError(c, 'verifier_unavailable');
        }
        throw err;
      }
    },
  );

  /** Finish: verify the wallet's proof and save the company. */
  app.post(
    '/proof/verify',
    bodyLimit({ maxSize: 256 * 1024, onError: (c) => apiError(c, 'invalid_request') }),
    rateLimit({
      kv: deps.kv,
      name: 'proof-verify',
      limit: 20,
      windowSeconds: 600,
      trustProxy: deps.trustProxy,
    }),
    async (c) => {
      const body = VerifyBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return apiError(c, 'invalid_request');
      try {
        const business = await deps.companyProof.finish(
          c.var.account,
          body.data.proofId,
          body.data.presentation,
        );
        return c.json({ business: toView(business, deps.network) });
      } catch (err) {
        if (err instanceof ProofError) {
          console.warn(`[proof] ${err.code} for ${c.var.account}: ${err.detail ?? ''}`);
          return apiError(c, err.code);
        }
        if (err instanceof VerifierError) {
          console.error('[proof] verifier error on verify:', err.status, err.code ?? '', err.message);
          // 4xx from the service means the presentation itself was rejected.
          return apiError(c, err.status >= 400 && err.status < 500 ? 'proof_failed' : 'verifier_unavailable');
        }
        throw err;
      }
    },
  );

  return app;
}
