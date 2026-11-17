import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { NETWORK_CONFIG, type Network } from '@cachet/shared';

export interface AppDeps {
  network: Network;
  version: string;
}

/** Plain-English JSON error shape used by every endpoint: { error: { code, message } }. */
function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.use(secureHeaders());

  app.get('/healthz', (c) =>
    c.json({
      ok: true,
      service: 'cachet',
      version: deps.version,
      network: deps.network,
      chain: NETWORK_CONFIG[deps.network].caip2,
    }),
  );

  app.notFound((c) => c.json(errorBody('not_found', 'This page does not exist.'), 404));

  app.onError((err, c) => {
    console.error('[api] unhandled error', err);
    return c.json(errorBody('internal', 'Something went wrong on our side. Please try again.'), 500);
  });

  return app;
}
