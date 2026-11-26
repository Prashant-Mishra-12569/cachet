import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { parseAccountSignature } from '@cachet/concordium';
import { explorerTxUrl, type Network } from '@cachet/shared';
import { publicJwk, ULID_FORMAT, type SealSigningKey } from '@cachet/shared/seal';
import type { AgentRepo } from '../../agents/repo';
import type { KvStore } from '../../infra/kv';
import type { SealRepo } from '../../seals/repo';
import { SealError, type SealService } from '../../seals/service';
import type { SealBilling } from '../../x402/billing';
import { apiError } from '../errors';
import { clientIp, rateLimit } from '../middleware';
import type { MiddlewareHandler } from 'hono';
import { PAYMENT_RESPONSE, PAYMENT_SIGNATURE, billingFail, paymentRequired } from './credits';

export interface SealRouteDeps {
  kv: KvStore;
  seals: SealService;
  signingKey: SealSigningKey;
  network: Network;
  trustProxy: boolean;
  /** x402 per-seal payment when an AI caller has no credits left. */
  billing?:
    | {
        billing: SealBilling;
        agents: Pick<AgentRepo, 'findByBadge'>;
        credits: Pick<SealRepo, 'creditBalance'>;
      }
    | undefined;
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

/**
 * Real AI callers send many seals from one server (a voice platform), and every seal is paid for, so
 * successful requests only get a generous flood cap. What attackers produce is FAILURES (forged or
 * replayed requests, unknown agents): those have their own small budget per IP.
 */
const FLOOD_CAP_PER_10_MIN = 36_000; // 60 per second
const FAILURES_PER_10_MIN = 300;
const ATTACK_LIKE = new Set([
  'invalid_request',
  'seal_stale',
  'seal_replay',
  'seal_bad_signature',
  'agent_unknown',
  'agent_account_mismatch',
  'seal_not_found',
]);

function failureBudget(kv: KvStore, trustProxy: boolean): MiddlewareHandler {
  return async (c, next) => {
    const key = `rl:seal-fail:${clientIp(c, trustProxy)}:${Math.floor(Date.now() / 600_000)}`;
    if (Number((await kv.get(key)) ?? 0) >= FAILURES_PER_10_MIN) {
      c.header('Retry-After', '600');
      return apiError(c, 'rate_limited');
    }
    await next();
    if (c.res.status >= 400 && c.res.status < 500) {
      const body = (await c.res
        .clone()
        .json()
        .catch(() => null)) as { error?: { code?: string } } | null;
      if (ATTACK_LIKE.has(body?.error?.code ?? '')) await kv.incr(key, 600);
    }
  };
}

export function sealRoutes(deps: SealRouteDeps) {
  const app = new Hono();
  const limit = (name: string, max: number) =>
    rateLimit({ kv: deps.kv, name, limit: max, windowSeconds: 600, trustProxy: deps.trustProxy });
  const failures = failureBudget(deps.kv, deps.trustProxy);

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
    limit('seal-issue', FLOOD_CAP_PER_10_MIN),
    failures,
    async (c) => {
      const body = await parse(c, SealRequestSchema);
      if (!body) return apiError(c, 'invalid_request');
      // Every seal is prepaid via x402 (plan §13.1). An AI caller with no credits gets the x402 terms
      // for ONE seal; its x402 client pays and sends the same request again. This happens BEFORE the
      // seal service runs, so the request's one-time nonce is still unused for the paid retry.
      if (deps.billing) {
        const agent = await deps.billing.agents.findByBadge(body.request.badge);
        if (agent && agent.status === 'active' && agent.agentAccount === body.request.agentAccount) {
          const header = c.req.header(PAYMENT_SIGNATURE);
          const mustPay = Boolean(header) || (await deps.billing.credits.creditBalance(agent.id)) === 0;
          if (mustPay) {
            // Only a fresh, unused, genuinely signed request may be asked to pay (or be paid for).
            try {
              await deps.seals.precheck(body.request, body.signature);
            } catch (err) {
              return fail(c, err);
            }
          }
          try {
            if (header) {
              const bought = await deps.billing.billing.purchase({
                header,
                credits: 1,
                expectedAgent: agent,
              });
              c.header(PAYMENT_RESPONSE, bought.responseHeader);
            } else if (mustPay) {
              return await paymentRequired(c, deps.billing.billing, 1, 'One sealed AI call');
            }
          } catch (err) {
            return billingFail(c, err);
          }
        }
      }
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
    limit('seal-close', FLOOD_CAP_PER_10_MIN),
    failures,
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
      return c.json(withExplorerLinks(view, deps.network));
    } catch (err) {
      return fail(c, err);
    }
  });

  return app;
}

type SealView = Awaited<ReturnType<SealService['publicView']>>;

/** Add CCDScan links for the company proof and the on-chain record. */
export function withExplorerLinks<V extends SealView>(view: V, network: Network) {
  return {
    ...view,
    company: { ...view.company, proofTxUrl: explorerTxUrl(network, view.company.proofTx) },
    anchor:
      'txHash' in view.anchor && view.anchor.txHash
        ? { ...view.anchor, txUrl: explorerTxUrl(network, view.anchor.txHash) }
        : view.anchor,
  };
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
