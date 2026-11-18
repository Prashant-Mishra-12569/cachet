import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { NETWORK_CONFIG, type Network } from '@cachet/shared';
import type { AuthService } from '../auth/service';
import type { KvStore } from '../infra/kv';
import { apiError } from './errors';
import { authRoutes } from './routes/auth';

export interface AppDeps {
  network: Network;
  version: string;
  kv: KvStore;
  auth: AuthService;
  webOrigin: string;
  secureCookies: boolean;
  trustProxy: boolean;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.use(secureHeaders());

  app.get('/healthz', async (c) =>
    c.json({
      ok: true,
      service: 'cachet',
      version: deps.version,
      network: deps.network,
      chain: NETWORK_CONFIG[deps.network].caip2,
      redis: (await deps.kv.ping()) ? 'ok' : 'down',
    }),
  );

  app.route('/v1/auth', authRoutes(deps));

  app.notFound((c) => apiError(c, 'not_found'));

  app.onError((err, c) => {
    console.error('[api] unhandled error', err);
    return apiError(c, 'internal');
  });

  return app;
}
