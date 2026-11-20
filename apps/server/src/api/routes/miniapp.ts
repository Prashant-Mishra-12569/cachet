import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { explorerTxUrl, type Network } from '@cachet/shared';
import { ULID_FORMAT, formatCode, type Seal } from '@cachet/shared/seal';
import type { FamilyRepo } from '../../bot/family-repo';
import type { PeopleRepo, PersonRow } from '../../bot/people-repo';
import type { KvStore } from '../../infra/kv';
import { verifyInitData } from '../../miniapp/init-data';
import type { PayService } from '../../pay/service';
import type { SealRepo } from '../../seals/repo';
import { SealError, statusOf, type SealService } from '../../seals/service';
import { apiError } from '../errors';
import { clientIp } from '../middleware';
import { ConfirmBody, PrepareBody, createPayPass, payFail, payView } from './pay';
import { withExplorerLinks } from './seals';

export interface MiniAppRouteDeps {
  kv: KvStore;
  /** HMAC key derived from the bot token (webAppSecret). */
  miniAppSecret: Buffer;
  people: Pick<PeopleRepo, 'byTelegramId'>;
  sealRepo: Pick<SealRepo, 'historyForPhone'>;
  seals: SealService;
  family: Pick<FamilyRepo, 'linksOf'>;
  network: Network;
  trustProxy: boolean;
  /** Safe payments; absent when the sponsor key isn't configured. */
  pay?: PayService | undefined;
  now?: () => number;
}

type MiniAppEnv = { Variables: { person: PersonRow; firstName: string } };

/**
 * Telegram Mini App API (plan §11.4). Every request carries Telegram's signed launch data in
 * `Authorization: tma <initData>` and is checked on EVERY call (no cookie, no session to steal).
 * Only people who registered their number with the bot get data, and only their own.
 */
export function miniAppRoutes(deps: MiniAppRouteDeps) {
  const app = new Hono<MiniAppEnv>();
  const now = deps.now ?? Date.now;

  async function over(key: string, max: number) {
    const window = Math.floor(now() / 600_000);
    return (await deps.kv.incr(`rl:tg:${key}:${window}`, 600)) > max;
  }

  const requireTelegram: MiddlewareHandler<MiniAppEnv> = async (c, next) => {
    if (await over(`ip:${clientIp(c, deps.trustProxy)}`, 600)) return apiError(c, 'rate_limited');
    const header = c.req.header('authorization') ?? '';
    const raw = header.startsWith('tma ') ? header.slice(4) : null;
    const check = verifyInitData(raw, deps.miniAppSecret, now());
    if (!check.ok) {
      if (check.reason !== 'missing') console.warn(`[miniapp] sign-in refused: ${check.reason}`);
      return apiError(c, check.reason === 'expired' ? 'tg_session_expired' : 'tg_auth_failed');
    }
    if (await over(`user:${check.user.id}`, 300)) return apiError(c, 'rate_limited');
    const person = await deps.people.byTelegramId(check.user.id);
    if (!person) return apiError(c, 'tg_not_registered');
    c.set('person', person);
    c.set('firstName', check.user.firstName);
    c.header('Cache-Control', 'private, no-store');
    return next();
  };

  app.use('*', requireTelegram);

  /** Home screen: my last sealed calls + who protects whom. */
  app.get('/me', async (c) => {
    const person = c.var.person;
    const rows = await deps.sealRepo.historyForPhone(person.phoneHash, 10);
    const links = await deps.family.linksOf(person.id);
    return c.json({
      firstName: c.var.firstName,
      protectedSince: person.createdAt.toISOString(),
      calls: rows.map((r) => {
        const seal = JSON.parse(r.sealJson) as Seal;
        const status = statusOf(r, now());
        return {
          sealId: r.id,
          company: seal.company.legalName,
          purpose: seal.purpose,
          message: seal.message,
          amount: seal.amount ?? null,
          status,
          issuedAt: r.issuedAt.toISOString(),
          // The code helps only during the call; afterwards it is history, not a secret to keep showing.
          code: status === 'open' ? formatCode(seal.code) : null,
        };
      }),
      family: {
        protects: links.filter((l) => l.guardianPersonId === person.id).map((l) => l.wardLabel),
        protectedBy: links.filter((l) => l.wardPersonId === person.id).map((l) => l.guardianName),
      },
    });
  });

  /** One seal, as the called person sees it (with the code and the safe-payment details). */
  app.get('/seals/:id', async (c) => {
    const id = c.req.param('id');
    if (!ULID_FORMAT.test(id)) return apiError(c, 'seal_not_found');
    try {
      const view = await deps.seals.calleeView(id, c.var.person.phoneHash);
      return c.json({
        ...withExplorerLinks(view, deps.network),
        paid: view.paid ? { ...view.paid, txUrl: explorerTxUrl(deps.network, view.paid.txHash) } : null,
      });
    } catch (err) {
      if (err instanceof SealError) return apiError(c, err.code);
      throw err;
    }
  });

  /** Safe payment, step 1: build the sponsored transfer for the person's wallet to approve. */
  app.post(
    '/pay/:id/prepare',
    bodyLimit({ maxSize: 2 * 1024, onError: (c) => apiError(c, 'invalid_request') }),
    async (c) => {
      if (!deps.pay) return apiError(c, 'pay_unavailable');
      const id = c.req.param('id');
      const body = PrepareBody.safeParse(await c.req.json().catch(() => null));
      if (!ULID_FORMAT.test(id) || !body.success) return apiError(c, 'invalid_request');
      if (await over(`prepare:${c.var.person.id}`, 10)) return apiError(c, 'rate_limited');
      try {
        return c.json(await deps.pay.prepare(id, c.var.person.phoneHash, body.data.sender));
      } catch (err) {
        return payFail(c, err);
      }
    },
  );

  /** Safe payment, step 2: the wallet sent it; we check it on chain and record it. */
  app.post(
    '/pay/:id/confirm',
    bodyLimit({ maxSize: 1024, onError: (c) => apiError(c, 'invalid_request') }),
    async (c) => {
      if (!deps.pay) return apiError(c, 'pay_unavailable');
      const id = c.req.param('id');
      const body = ConfirmBody.safeParse(await c.req.json().catch(() => null));
      if (!ULID_FORMAT.test(id) || !body.success) return apiError(c, 'invalid_request');
      if (await over(`confirm:${c.var.person.id}`, 60)) return apiError(c, 'rate_limited');
      try {
        const paid = await deps.pay.confirm(id, c.var.person.phoneHash, body.data.txHash);
        return c.json({ ...paid, txUrl: explorerTxUrl(deps.network, paid.txHash) });
      } catch (err) {
        return payFail(c, err);
      }
    },
  );

  /**
   * Phones: continue paying in the phone's browser (Telegram's web view can't open wallet apps).
   * Returns a one-time pass for THIS seal only; the page keeps it in the URL #fragment.
   */
  app.post('/pay/:id/handoff', async (c) => {
    if (!deps.pay) return apiError(c, 'pay_unavailable');
    const id = c.req.param('id');
    if (!ULID_FORMAT.test(id)) return apiError(c, 'seal_not_found');
    if (await over(`handoff:${c.var.person.id}`, 20)) return apiError(c, 'rate_limited');
    try {
      const view = await payView(deps.seals, id, c.var.person.phoneHash, deps.network);
      if (!view.pay) return apiError(c, 'pay_not_requested');
      if (view.paid) return apiError(c, 'pay_already_paid');
      if (!view.pay.ready) return apiError(c, 'pay_closed');
      return c.json(await createPayPass(deps.kv, id, c.var.person.phoneHash));
    } catch (err) {
      return payFail(c, err);
    }
  });

  return app;
}
