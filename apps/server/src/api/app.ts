import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { NETWORK_CONFIG, type Network } from '@cachet/shared';
import type { AuthService } from '../auth/service';
import type { CompanyProofService } from '../business/company-proof';
import type { BusinessRepo } from '../business/repo';
import type { KvStore } from '../infra/kv';
import { apiError } from './errors';
import { authRoutes } from './routes/auth';
import { businessRoutes } from './routes/business';

export interface AppDeps {
  network: Network;
  version: string;
  kv: KvStore;
  auth: AuthService;
  repo: BusinessRepo;
  companyProof: CompanyProofService;
  webOrigin: string;
  secureCookies: boolean;
  trustProxy: boolean;
  /** Extra health checks (database, verifier); each returns true when healthy. */
  checks?: Record<string, () => Promise<boolean>>;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.use(secureHeaders());

  app.get('/healthz', async (c) => {
    const entries = Object.entries({ redis: () => deps.kv.ping(), ...deps.checks });
    const results = await Promise.all(
      entries.map(async ([name, check]) => [name, (await check()) ? 'ok' : 'down']),
    );
    return c.json({
      ok: true,
      service: 'cachet',
      version: deps.version,
      network: deps.network,
      chain: NETWORK_CONFIG[deps.network].caip2,
      ...Object.fromEntries(results),
    });
  });

  app.route('/v1/auth', authRoutes(deps));
  app.route('/v1/business', businessRoutes(deps));

  app.notFound((c) => apiError(c, 'not_found'));

  app.onError((err, c) => {
    console.error('[api] unhandled error', err);
    return apiError(c, 'internal');
  });

  return app;
}
