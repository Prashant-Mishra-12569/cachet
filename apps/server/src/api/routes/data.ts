import { Hono, type MiddlewareHandler } from 'hono';
import type { ApiKeys } from '../../business/api-keys';
import { parseRange, type Dashboard } from '../../business/dashboard';
import type { KvStore } from '../../infra/kv';
import { apiError } from '../errors';

/**
 * The read-only data API (/v1/data/*): a company's own systems pull its numbers with an API key.
 * There are only GET routes here: a key can never change anything, and never sees phone numbers or
 * call codes (the same privacy rules as the dashboard).
 */
type KeyEnv = { Variables: { businessId: string } };

export function dataRoutes(deps: {
  apiKeys: ApiKeys;
  dashboard: Dashboard;
  kv: KvStore;
  now?: () => number;
}) {
  const app = new Hono<KeyEnv>();
  const now = deps.now ?? Date.now;

  const requireKey: MiddlewareHandler<KeyEnv> = async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const found = key ? await deps.apiKeys.verify(key) : null;
    if (!found) return apiError(c, 'api_key_invalid');
    // 120 requests per 10 minutes per company (all its keys together).
    const window = Math.floor(now() / 600_000);
    if ((await deps.kv.incr(`rl:data:${found.businessId}:${window}`, 600)) > 120)
      return apiError(c, 'rate_limited');
    c.set('businessId', found.businessId);
    c.header('Cache-Control', 'no-store');
    return next();
  };
  app.use('*', requireKey);

  app.get('/summary', async (c) => c.json(await deps.dashboard.summary(c.var.businessId)));

  app.get('/calls', async (c) => {
    const range = parseRange(c.req.query('from'), c.req.query('to'), new Date(now()));
    if (!range) return apiError(c, 'invalid_range');
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
    return c.json(await deps.dashboard.calls(c.var.businessId, range, c.req.query('cursor'), limit));
  });

  app.get('/payments', async (c) => c.json(await deps.dashboard.payments(c.var.businessId)));

  app.get('/calls.csv', async (c) => {
    const range = parseRange(c.req.query('from'), c.req.query('to'), new Date(now()));
    if (!range) return apiError(c, 'invalid_range');
    const { csv } = await deps.dashboard.callsCsv(c.var.businessId, range);
    c.header('Content-Type', 'text/csv; charset=utf-8');
    return c.body(csv);
  });

  return app;
}
