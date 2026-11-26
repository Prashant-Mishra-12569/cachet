import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { explorerTxUrl, type Network } from '@cachet/shared';
import type { AuthService } from '../../auth/service';
import { ProofError, type CompanyProofService } from '../../business/company-proof';
import type { BusinessRecord, BusinessRepo } from '../../business/repo';
import { parseRange, type Dashboard } from '../../business/dashboard';
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
  /** The company dashboard and compliance exports. */
  dashboard?: Dashboard;
  /** Risk scoring: the company's own report numbers, shown on its dashboard. */
  riskStatus?: {
    status(
      businessId: string,
    ): Promise<{ reporters: number; called: number; suspendAt: number; windowDays: number }>;
  };
  /** The company's AI callers (a "never calls" company may not have a live one). */
  agents: { list(account: string): Promise<{ status: string }[]> };
}

const NeverCallsBody = z.object({ neverCalls: z.boolean() }).strict();

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

  /**
   * "We never make AI calls": any call claiming to be this company is then shown as a scam.
   * Not allowed while the company has an AI caller that is registered or live.
   */
  app.post('/never-calls', async (c) => {
    const body = NeverCallsBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return apiError(c, 'invalid_request');
    const business = await deps.repo.findByAccount(c.var.account);
    if (!business || business.status !== 'active') return apiError(c, 'business_not_verified');
    if (body.data.neverCalls) {
      const live = (await deps.agents.list(c.var.account)).some(
        (a) => a.status === 'active' || a.status === 'registered',
      );
      if (live) return apiError(c, 'never_calls_has_ai_caller');
    }
    if (business.neverCalls === body.data.neverCalls) {
      return c.json({ business: toView(business, deps.network) }); // no change, no new record
    }
    const updated = await deps.repo.setNeverCalls(business.id, body.data.neverCalls, new Date());
    return c.json({ business: toView(updated, deps.network) });
  });

  if (deps.dashboard) dashboardRoutes(app, deps, deps.dashboard);

  return app;
}

/** Byte-order mark: lets Excel open the CSV's accented names (é, ü) correctly. */
const UTF8_BOM = String.fromCharCode(0xfeff);

/** /v1/business/dashboard/*: only the signed-in company's own data, never cached. */
function dashboardRoutes(app: Hono<SessionEnv>, deps: BusinessRouteDeps, dashboard: Dashboard) {
  const company = async (account: string) => deps.repo.findByAccount(account);
  const exportLimit = rateLimit({
    kv: deps.kv,
    name: 'dash-export',
    limit: 30,
    windowSeconds: 600,
    trustProxy: deps.trustProxy,
    byAccount: true,
  });

  app.get('/dashboard', async (c) => {
    const b = await company(c.var.account);
    if (!b) return apiError(c, 'business_not_verified');
    c.header('Cache-Control', 'no-store');
    const [summary, risk] = await Promise.all([
      dashboard.summary(b.id),
      deps.riskStatus ? deps.riskStatus.status(b.id) : Promise.resolve(null),
    ]);
    return c.json({ ...summary, company: { status: b.status }, risk });
  });

  app.get('/dashboard/calls', async (c) => {
    const b = await company(c.var.account);
    if (!b) return apiError(c, 'business_not_verified');
    const range = parseRange(c.req.query('from'), c.req.query('to'), new Date());
    if (!range) return apiError(c, 'invalid_range');
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
    c.header('Cache-Control', 'no-store');
    return c.json(await dashboard.calls(b.id, range, c.req.query('cursor'), limit));
  });

  app.get('/dashboard/payments', async (c) => {
    const b = await company(c.var.account);
    if (!b) return apiError(c, 'business_not_verified');
    c.header('Cache-Control', 'no-store');
    return c.json(await dashboard.payments(b.id));
  });

  app.get('/dashboard/reports', async (c) => {
    const b = await company(c.var.account);
    if (!b) return apiError(c, 'business_not_verified');
    c.header('Cache-Control', 'no-store');
    return c.json(await dashboard.reports(b.id));
  });

  /** All calls in a period as CSV (a download). */
  app.get('/dashboard/export/calls.csv', exportLimit, async (c) => {
    const b = await company(c.var.account);
    if (!b) return apiError(c, 'business_not_verified');
    const range = parseRange(c.req.query('from'), c.req.query('to'), new Date());
    if (!range) return apiError(c, 'invalid_range');
    const { csv } = await dashboard.callsCsv(b.id, range);
    const name = `cachet-calls_${range.from.toISOString().slice(0, 10)}_${new Date(range.to.getTime() - 1).toISOString().slice(0, 10)}.csv`;
    c.header('Cache-Control', 'no-store');
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="${name}"`);
    return c.body(UTF8_BOM + csv);
  });

  /** Everything for the printable compliance report (the page turns it into a PDF). */
  app.get('/dashboard/export/report', exportLimit, async (c) => {
    const b = await company(c.var.account);
    if (!b) return apiError(c, 'business_not_verified');
    const range = parseRange(c.req.query('from'), c.req.query('to'), new Date());
    if (!range) return apiError(c, 'invalid_range');
    c.header('Cache-Control', 'no-store');
    return c.json(await dashboard.compliance(b, range));
  });
}
