import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { NETWORK_CONFIG, type Network } from '@cachet/shared';
import type { SealSigningKey } from '@cachet/shared/seal';
import type { AgentService } from '../agents/service';
import type { SealService } from '../seals/service';
import type { AuthService } from '../auth/service';
import type { CompanyProofService } from '../business/company-proof';
import type { BusinessRepo } from '../business/repo';
import type { KvStore } from '../infra/kv';
import { apiError } from './errors';
import { agentRoutes } from './routes/agents';
import { authRoutes } from './routes/auth';
import { miniAppRoutes, type MiniAppRouteDeps } from './routes/miniapp';
import { browserPayRoutes } from './routes/pay';
import { creditRoutes } from './routes/credits';
import { sealRoutes, wellKnownRoutes, type SealRouteDeps } from './routes/seals';
import { businessRoutes } from './routes/business';
import type { PublicStatsService } from '../stats/public-stats';

export interface AppDeps {
  network: Network;
  version: string;
  kv: KvStore;
  auth: AuthService;
  repo: BusinessRepo;
  companyProof: CompanyProofService;
  agents: AgentService;
  seals: SealService;
  signingKey: SealSigningKey;
  /** Public Agent Registry service URL (for badge-check links). */
  registryUrl: string;
  webOrigin: string;
  secureCookies: boolean;
  trustProxy: boolean;
  /** x402 seal billing (/v1/credits/purchase + per-seal payment). Absent = credits only. */
  x402?: SealRouteDeps['billing'];
  /** Telegram Mini App API (/v1/tg/*). Only when the bot token is set. */
  miniApp?: Pick<MiniAppRouteDeps, 'miniAppSecret' | 'people' | 'sealRepo' | 'family' | 'pay' | 'now'>;
  /** Live totals for the public website (/v1/stats). */
  stats?: PublicStatsService;
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

  if (deps.stats) {
    const stats = deps.stats;
    // Public totals for the landing page (no people, no codes). Cached 30 s here and at the edge.
    app.get('/v1/stats', async (c) => {
      c.header('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
      return c.json(await stats.get());
    });
  }

  app.route('/v1/auth', authRoutes(deps));
  app.route('/v1/business', businessRoutes(deps));
  app.route('/v1/agents', agentRoutes(deps));
  app.route('/v1/seals', sealRoutes({ ...deps, billing: deps.x402 }));
  if (deps.x402) app.route('/v1/credits', creditRoutes({ ...deps, billing: deps.x402.billing }));
  if (deps.miniApp) {
    app.route('/v1/tg', miniAppRoutes({ ...deps, ...deps.miniApp }));
    // Paying from the phone's browser, with a one-time pass from the Mini App.
    app.route('/v1/pay', browserPayRoutes({ ...deps, pay: deps.miniApp.pay }));
  }
  app.route('/.well-known', wellKnownRoutes(deps));

  app.notFound((c) => apiError(c, 'not_found'));

  app.onError((err, c) => {
    console.error('[api] unhandled error', err);
    return apiError(c, 'internal');
  });

  return app;
}
