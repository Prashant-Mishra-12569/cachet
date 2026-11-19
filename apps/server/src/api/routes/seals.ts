import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { parseAccountSignature } from '@cachet/concordium';
import { explorerTxUrl, type Network } from '@cachet/shared';
import { publicJwk, ULID_FORMAT, type SealSigningKey } from '@cachet/shared/seal';
import type { KvStore } from '../../infra/kv';
import { SealError, type SealService } from '../../seals/service';
import { apiError } from '../errors';
import { rateLimit } from '../middleware';

export interface SealRouteDeps {
  kv: KvStore;
  seals: SealService;
  signingKey: SealSigningKey;
  network: Network;
  trustProxy: boolean;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const NONCE = /^[0-9a-f]{32,64}$/;

// .strict(): the AI signs the exact object it sends. Silently dropping unknown fields would change
// the signed digest, so unknown fields are an error instead.
const SealRequestSchema = z
  .object({
    v: z.literal('cachet-seal-request/1'),
    badge: z.string().min(10).max(40).regex(BASE58),
    agentAccount: z.string().length(50).regex(BASE58),
    to: z.string().min(4).max(32),
    from: z.string().min(4).max(32),
    purpose: z.string().min(1).max(32),
    message: z.string().min(1).max(200),
    amount: z
      .object({ value: z.string().min(1).max(20), asset: z.string().min(1).max(32) })
      .strict()
      .optional(),
    nonce: z.string().regex(NONCE),
    ts: z.number().int().positive(),
  })
  .strict();

const CloseRequestSchema = z
  .object({
    v: z.literal('cachet-seal-close/1'),
    sealId: z.string().regex(ULID_FORMAT),
    agentAccount: z.string().length(50).regex(BASE58),
    reason: z.enum(['completed', 'no_answer', 'failed', 'cancelled']),
    nonce: z.string().regex(NONCE),
    ts: z.number().int().positive(),
  })
  .strict();

const Envelope = z.object({ request: z.unknown(), signature: z.unknown() });

export function sealRoutes(deps: SealRouteDeps) {
  const app = new Hono();
  const limit = (name: string, max: number) =>
    rateLimit({ kv: deps.kv, name, limit: max, windowSeconds: 600, trustProxy: deps.trustProxy });

  async function parse<T>(c: { req: { json: () => Promise<unknown> } }, schema: z.ZodType<T>) {
    const env = Envelope.safeParse(await c.req.json().catch(() => null));
    if (!env.success) return null;
    const request = schema.safeParse(env.data.request);
    const signature = parseAccountSignature(env.data.signature);
    if (!request.success || !signature) return null;
    return { request: request.data, signature };
  }

  function fail(c: Parameters<typeof apiError>[0], err: unknown) {
    if (err instanceof SealError) {
      if (err.detail) console.warn(`[seals] ${err.code}: ${err.detail}`);
      return apiError(c, err.code);
    }
    throw err;
  }

  /** The AI asks for a seal right before it dials. */
  app.post(
    '/',
    bodyLimit({ maxSize: 16 * 1024, onError: (c) => apiError(c, 'invalid_request') }),
    limit('seal-issue', 600),
    async (c) => {
      const body = await parse(c, SealRequestSchema);
      if (!body) return apiError(c, 'invalid_request');
      try {
        return c.json(await deps.seals.issue(body.request, body.signature), 201);
      } catch (err) {
        return fail(c, err);
      }
    },
  );

  /** The AI says the call ended. */
  app.post(
    '/:id/close',
    bodyLimit({ maxSize: 8 * 1024, onError: (c) => apiError(c, 'invalid_request') }),
    limit('seal-close', 600),
    async (c) => {
      const body = await parse(c, CloseRequestSchema);
      if (!body || body.request.sealId !== c.req.param('id')) return apiError(c, 'invalid_request');
      try {
        return c.json(await deps.seals.close(body.request, body.signature));
      } catch (err) {
        return fail(c, err);
      }
    },
  );

  /** Public, share-safe seal view (no phone data, no call code). */
  app.get('/:id', limit('seal-view', 300), async (c) => {
    const id = c.req.param('id');
    if (!ULID_FORMAT.test(id)) return apiError(c, 'seal_not_found');
    try {
      const view = await deps.seals.publicView(id);
      c.header('Cache-Control', 'no-store');
      return c.json({
        ...view,
        company: { ...view.company, proofTxUrl: explorerTxUrl(deps.network, view.company.proofTx) },
        anchor:
          'txHash' in view.anchor && view.anchor.txHash
            ? { ...view.anchor, txUrl: explorerTxUrl(deps.network, view.anchor.txHash) }
            : view.anchor,
      });
    } catch (err) {
      return fail(c, err);
    }
  });

  return app;
}

/** GET /.well-known/cachet-keys.json — anyone can verify seal signatures offline with these keys. */
export function wellKnownRoutes(deps: { signingKey: SealSigningKey }) {
  const app = new Hono();
  app.get('/cachet-keys.json', (c) => {
    c.header('Cache-Control', 'public, max-age=3600');
    return c.json({ keys: [publicJwk(deps.signingKey)] });
  });
  return app;
}
