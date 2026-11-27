import { Hono } from 'hono';
import { z } from 'zod';
import type { Network } from '@cachet/shared';
import { normalizeE164 } from '@cachet/shared/seal';
import type { KvStore } from '../../infra/kv';
import type { SealService } from '../../seals/service';
import { apiError } from '../errors';
import { rateLimit } from '../middleware';
import { withExplorerLinks } from './seals';

/**
 * POST /v1/calls/verify: agent-to-agent call verification. An AI that ANSWERS calls (a receptionist, a
 * person's own AI assistant) sends the number it answers for and the code the caller said. Yes only if
 * that exact sealed call is open right now; no otherwise. The answer never includes the code or a number.
 *
 * Guessing is limited: 10 tries per answered number and 60 per IP address per 10 minutes, and a
 * 4-digit code changes with every call.
 */
const Body = z
  .object({
    to: z.string().min(4).max(32),
    code: z.string().min(4).max(12),
  })
  .strict();

const PER_NUMBER = 10;

export function verifyCallRoutes(deps: {
  kv: KvStore;
  seals: Pick<SealService, 'verifyIncoming' | 'fingerprint'>;
  network: Network;
  webOrigin: string;
  trustProxy: boolean;
}) {
  const app = new Hono();
  app.post(
    '/verify',
    rateLimit({
      kv: deps.kv,
      name: 'verify-call',
      limit: 60,
      windowSeconds: 600,
      trustProxy: deps.trustProxy,
    }),
    async (c) => {
      const body = Body.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return apiError(c, 'invalid_request');
      const to = normalizeE164(body.data.to);
      if (!to) return apiError(c, 'invalid_phone');
      // Keyed by the secret fingerprint: the number itself never lands in Redis.
      const numberKey = deps.seals.fingerprint(to);
      const window = Math.floor(Date.now() / 600_000);
      if ((await deps.kv.incr(`rl:verify-call:n:${numberKey}:${window}`, 600)) > PER_NUMBER) {
        c.header('Retry-After', '600');
        return apiError(c, 'rate_limited');
      }
      const view = await deps.seals.verifyIncoming(to, body.data.code);
      c.header('Cache-Control', 'no-store');
      if (!view) return c.json({ verified: false });
      return c.json({
        verified: true,
        seal: { ...withExplorerLinks(view, deps.network), publicUrl: `${deps.webOrigin}/v/${view.id}` },
      });
    },
  );
  return app;
}
