import { createHash, randomBytes } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { explorerTxUrl, type Network } from '@cachet/shared';
import { ULID_FORMAT } from '@cachet/shared/seal';
import type { KvStore } from '../../infra/kv';
import { PayError, type PayService } from '../../pay/service';
import { SealError, type SealService } from '../../seals/service';
import { apiError } from '../errors';
import { clientIp } from '../middleware';

/**
 * Phones can't open a wallet app from inside Telegram (its web view refuses app links), so the person
 * continues the payment in their phone's browser. The Mini App gets a one-time pass for ONE seal; the
 * page carries it in the URL #fragment (never sent to any server or log) and sends it as
 * `Authorization: Pay <pass>`. The pass only allows viewing and paying that seal, for 30 minutes.
 */
const PASS_TTL_SECONDS = 30 * 60;
const passKey = (pass: string) => `pay:pass:${createHash('sha256').update(pass).digest('hex')}`;

export async function createPayPass(kv: KvStore, sealId: string, phoneHash: string) {
  const pass = randomBytes(24).toString('base64url');
  await kv.set(passKey(pass), JSON.stringify({ sealId, phoneHash }), PASS_TTL_SECONDS);
  return { pass, expiresInSeconds: PASS_TTL_SECONDS };
}

export const PrepareBody = z.object({ sender: z.string().min(40).max(60) }).strict();
export const ConfirmBody = z.object({ txHash: z.string().regex(/^[0-9a-fA-F]{64}$/) }).strict();

export function payFail(c: Context, err: unknown) {
  if (err instanceof PayError || err instanceof SealError) {
    if (err.detail) console.warn(`[pay] ${err.code}: ${err.detail}`);
    return apiError(c, err.code);
  }
  throw err;
}

/** The parts of the seal the payment page needs (no call code: it isn't needed to pay). */
export async function payView(seals: SealService, sealId: string, phoneHash: string, network: Network) {
  const v = await seals.calleeView(sealId, phoneHash);
  return {
    id: v.id,
    status: v.status,
    company: {
      legalName: v.company.legalName,
      legalCountry: v.company.legalCountry,
      status: v.company.status,
    },
    pay: v.pay,
    paid: v.paid ? { ...v.paid, txUrl: explorerTxUrl(network, v.paid.txHash) } : null,
  };
}

export interface BrowserPayDeps {
  kv: KvStore;
  seals: SealService;
  pay?: PayService | undefined;
  network: Network;
  trustProxy: boolean;
}

type PassEnv = { Variables: { phoneHash: string } };

export function browserPayRoutes(deps: BrowserPayDeps) {
  const app = new Hono<PassEnv>();

  const requirePass: MiddlewareHandler<PassEnv> = async (c, next) => {
    const window = Math.floor(Date.now() / 600_000);
    const ip = clientIp(c, deps.trustProxy);
    if ((await deps.kv.incr(`rl:paypass:${ip}:${window}`, 600)) > 300) return apiError(c, 'rate_limited');
    const header = c.req.header('authorization') ?? '';
    const pass = header.startsWith('Pay ') ? header.slice(4) : '';
    const raw = /^[A-Za-z0-9_-]{32}$/.test(pass) ? await deps.kv.get(passKey(pass)) : null;
    const grant = raw ? (JSON.parse(raw) as { sealId: string; phoneHash: string }) : null;
    // A pass is for one seal only.
    if (!grant || grant.sealId !== c.req.param('id')) return apiError(c, 'pay_pass_invalid');
    c.set('phoneHash', grant.phoneHash);
    c.header('Cache-Control', 'private, no-store');
    return next();
  };

  app.get('/:id', requirePass, async (c) => {
    const id = c.req.param('id');
    if (!ULID_FORMAT.test(id)) return apiError(c, 'seal_not_found');
    try {
      return c.json(await payView(deps.seals, id, c.var.phoneHash, deps.network));
    } catch (err) {
      return payFail(c, err);
    }
  });

  app.post(
    '/:id/prepare',
    bodyLimit({ maxSize: 2 * 1024, onError: (c) => apiError(c, 'invalid_request') }),
    requirePass,
    async (c) => {
      if (!deps.pay) return apiError(c, 'pay_unavailable');
      const body = PrepareBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return apiError(c, 'invalid_request');
      try {
        return c.json(await deps.pay.prepare(c.req.param('id'), c.var.phoneHash, body.data.sender));
      } catch (err) {
        return payFail(c, err);
      }
    },
  );

  app.post(
    '/:id/confirm',
    bodyLimit({ maxSize: 1024, onError: (c) => apiError(c, 'invalid_request') }),
    requirePass,
    async (c) => {
      if (!deps.pay) return apiError(c, 'pay_unavailable');
      const body = ConfirmBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return apiError(c, 'invalid_request');
      try {
        const paid = await deps.pay.confirm(c.req.param('id'), c.var.phoneHash, body.data.txHash);
        return c.json({ ...paid, txUrl: explorerTxUrl(deps.network, paid.txHash) });
      } catch (err) {
        return payFail(c, err);
      }
    },
  );

  return app;
}
