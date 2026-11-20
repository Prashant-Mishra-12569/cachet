import { Hono, type MiddlewareHandler } from 'hono';
import { type Network } from '@cachet/shared';
import { ULID_FORMAT, formatCode, type Seal } from '@cachet/shared/seal';
import type { FamilyRepo } from '../../bot/family-repo';
import type { PeopleRepo, PersonRow } from '../../bot/people-repo';
import type { KvStore } from '../../infra/kv';
import { verifyInitData } from '../../miniapp/init-data';
import type { SealRepo } from '../../seals/repo';
import { SealError, statusOf, type SealService } from '../../seals/service';
import { apiError } from '../errors';
import { clientIp } from '../middleware';
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
      return c.json(withExplorerLinks(view, deps.network));
    } catch (err) {
      if (err instanceof SealError) return apiError(c, err.code);
      throw err;
    }
  });

  return app;
}
