import { InlineKeyboard, type Bot, type Context } from 'grammy';
import type { Seal } from '@cachet/shared/seal';
import type { AgentRepo } from '../../agents/repo';
import type { BusinessRepo } from '../../business/repo';
import type { KvStore } from '../../infra/kv';
import type { SealRepo } from '../../seals/repo';
import { statusOf } from '../../seals/service';
import type { ConsentsRepo } from '../consents-repo';
import { ago, copy, esc, purposeWord } from '../copy';
import type { PeopleRepo, PersonRow } from '../people-repo';

export interface InfoDeps {
  people: PeopleRepo;
  seals: Pick<SealRepo, 'historyForPhone' | 'businessesForPhone'>;
  businesses: Pick<BusinessRepo, 'searchByName' | 'findById'>;
  agents: Pick<AgentRepo, 'listByBusiness'>;
  consents: ConsentsRepo;
  kv: KvStore;
  now: () => number;
}

const STATUS_WORDS = {
  open: 'in progress',
  closed: 'ended',
  superseded: 'replaced',
  expired: 'ended',
} as const;
const CONSENT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

/** /history, /company, /consent (plan §11.2). */
export function createInfoFeature(deps: InfoDeps) {
  async function me(ctx: Context): Promise<PersonRow | null> {
    return ctx.from ? deps.people.byTelegramId(ctx.from.id) : null;
  }
  async function limited(key: string, max: number) {
    const window = Math.floor(deps.now() / 600_000);
    return (await deps.kv.incr(`bot:rl:${key}:${window}`, 600)) > max;
  }

  /** Companies that sealed calls to this person recently (the only ones /consent lists). */
  async function recentCompanies(person: PersonRow) {
    const ids = await deps.seals.businessesForPhone(
      person.phoneHash,
      new Date(deps.now() - CONSENT_WINDOW_MS),
    );
    const out: { id: string; name: string; status: 'granted' | 'revoked' | null }[] = [];
    for (const id of ids.slice(0, 5)) {
      const b = await deps.businesses.findById(id);
      if (b) out.push({ id, name: b.legalName, status: await deps.consents.statusFor(person.phoneHash, id) });
    }
    return out;
  }

  /** The /consent message: one line per company + only the buttons that would change something. */
  function consentView(companies: Awaited<ReturnType<typeof recentCompanies>>) {
    const kb = new InlineKeyboard();
    for (const c of companies) {
      const short = c.name.length > 28 ? `${c.name.slice(0, 27)}…` : c.name;
      if (c.status !== 'granted') kb.text(copy.consentAllowButton(short), `cons:allow:${c.id}`);
      if (c.status !== 'revoked') kb.text(copy.consentBlockButton(short), `cons:block:${c.id}`);
      kb.row();
    }
    const text = [copy.consentTitle, ...companies.map((c) => copy.consentLine(c.name, c.status))].join('\n');
    return { text, kb };
  }

  async function showConsent(ctx: Context, person: PersonRow) {
    const companies = await recentCompanies(person);
    if (companies.length === 0) {
      await ctx.reply(copy.consentEmpty);
      return;
    }
    const { text, kb } = consentView(companies);
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }

  function register(bot: Bot) {
    bot.command('history', async (ctx) => {
      const person = await me(ctx);
      if (!person) {
        await ctx.reply(copy.needNumber);
        return;
      }
      const rows = await deps.seals.historyForPhone(person.phoneHash, 10);
      if (rows.length === 0) {
        await ctx.reply(copy.historyEmpty);
        return;
      }
      const lines = rows.map((r) => {
        const seal = JSON.parse(r.sealJson) as Seal;
        const status = STATUS_WORDS[statusOf(r, deps.now())];
        return `• <b>${esc(seal.company.legalName)}</b> · ${purposeWord(seal.purpose)} · ${ago(r.issuedAt.getTime(), deps.now())} · ${status}`;
      });
      await ctx.reply([copy.historyTitle, ...lines].join('\n'), { parse_mode: 'HTML' });
    });

    bot.command('company', async (ctx) => {
      const q = ctx.match.trim();
      if (q.length < 2 || q.length > 60) {
        await ctx.reply(copy.companyAsk, { parse_mode: 'HTML' });
        return;
      }
      if (await limited(`company:${ctx.from?.id ?? 0}`, 20)) {
        await ctx.reply(copy.tooManyChecks);
        return;
      }
      const found = (await deps.businesses.searchByName(q, 3)).filter((b) => b.status === 'active');
      if (found.length === 0) {
        await ctx.reply(copy.companyNone(q), { parse_mode: 'HTML' });
        return;
      }
      const parts: string[] = [];
      for (const b of found) {
        if (b.neverCalls) {
          parts.push(copy.companyNeverCalls(b.legalName));
          continue;
        }
        const callers = (await deps.agents.listByBusiness(b.id))
          .filter((a) => a.status === 'active')
          .map((a) => ({ name: a.name, numbers: a.callingNumbers }));
        parts.push(copy.companyFound(b.legalName, b.legalCountry, callers));
      }
      await ctx.reply(parts.join('\n\n'), { parse_mode: 'HTML' });
    });

    bot.command('consent', async (ctx) => {
      const person = await me(ctx);
      if (!person) {
        await ctx.reply(copy.needNumber);
        return;
      }
      await showConsent(ctx, person);
    });

    bot.callbackQuery(/^cons:(block|allow):([0-9a-f-]{36})$/, async (ctx) => {
      await ctx.answerCallbackQuery();
      const person = await me(ctx);
      if (!person) return;
      const action = ctx.match[1];
      const businessId = ctx.match[2] ?? '';
      // Only companies that actually sealed calls to this person can be allowed/blocked here.
      const companies = await recentCompanies(person);
      const company = companies.find((c) => c.id === businessId);
      if (!company) return;
      const status = action === 'block' ? 'revoked' : 'granted';
      if (company.status !== status) {
        await deps.consents.set(person.phoneHash, businessId, status, new Date(deps.now()));
      }
      company.status = status;
      // Update the list in place so it never shows an old state (and the undo button is right there).
      const { text, kb } = consentView(companies);
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }).catch(() => undefined);
      await ctx.reply(
        status === 'revoked' ? copy.consentBlocked(company.name) : copy.consentAllowed(company.name),
        {
          parse_mode: 'HTML',
        },
      );
    });
  }

  return { register };
}
