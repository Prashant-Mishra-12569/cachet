import { autoRetry } from '@grammyjs/auto-retry';
import { Bot, InlineKeyboard, Keyboard, type Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { normalizeE164, phoneHash, type Seal } from '@cachet/shared/seal';
import type { AgentRepo } from '../agents/repo';
import { errText } from '../infra/err-text';
import type { BusinessRepo } from '../business/repo';
import type { KvStore } from '../infra/kv';
import type { SealRepo } from '../seals/repo';
import type { ConsentsRepo } from './consents-repo';
import { copy } from './copy';
import type { FamilyRepo } from './family-repo';
import { createFamilyFeature, INVITE_PREFIX } from './features/family';
import { createInfoFeature } from './features/info';
import type { PeopleRepo } from './people-repo';
import type { PhoneCipher } from './phone-crypto';
import type { ReportsRepo } from './reports-repo';

export interface BotDeps {
  people: PeopleRepo;
  reports: ReportsRepo;
  seals: Pick<SealRepo, 'get' | 'openForPhone' | 'historyForPhone' | 'businessesForPhone'>;
  family: FamilyRepo;
  consents: ConsentsRepo;
  businesses: Pick<BusinessRepo, 'searchByName' | 'findById' | 'findByInviteCode'>;
  agents: Pick<AgentRepo, 'listByBusiness'>;
  kv: KvStore;
  /** End a blocked company's open seals to a person (seal service). */
  endSealsFrom?: (phoneHash: string, businessId: string) => Promise<number>;
  phoneCipher: PhoneCipher;
  phonePepper: string;
  now?: () => number;
}

/** Payload of a company's customer-invite link: t.me/<bot>?start=co_<invite code>. */
export const COMPANY_INVITE_PREFIX = 'co_';

const shareKeyboard = () => new Keyboard().requestContact(copy.shareButton).resized().oneTime();

/**
 * The Cachet Telegram bot: the main experience for people (plan §11).
 * Dev uses long polling; production will use a webhook.
 */
export function createBot(token: string, deps: BotDeps, options: { botInfo?: UserFromGetMe } = {}): Bot {
  const bot = new Bot(token, options.botInfo ? { botInfo: options.botInfo } : {});
  const now = deps.now ?? Date.now;
  // If Telegram says "slow down", wait and retry instead of losing a seal card.
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 10 }));

  // A public bot can be added to groups: never act (or reveal anything) outside a private chat.
  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== 'private') {
      if (ctx.message) await ctx.reply(copy.privateOnly).catch(() => undefined);
      return;
    }
    await next();
  });

  async function limited(key: string, max: number, windowSeconds: number): Promise<boolean> {
    const window = Math.floor(now() / 1000 / windowSeconds);
    return (await deps.kv.incr(`bot:rl:${key}:${window}`, windowSeconds)) > max;
  }

  const family = createFamilyFeature({ family: deps.family, people: deps.people, kv: deps.kv, now });
  const info = createInfoFeature({ ...deps, now });

  /** /start, /start fam_<token> (family invite) or /start co_<code> (a company's customer invite). */
  async function start(ctx: Context, payload: string) {
    const from = ctx.from;
    if (!from) return;
    if (payload.startsWith(COMPANY_INVITE_PREFIX)) {
      await companyInvite(ctx, payload.slice(COMPANY_INVITE_PREFIX.length));
      return;
    }
    const invite = payload.startsWith(INVITE_PREFIX) ? payload.slice(INVITE_PREFIX.length) : null;
    const person = await deps.people.byTelegramId(from.id);
    if (!person) {
      // Keep the invite while they share their number; continue right after.
      if (invite && /^[A-Za-z0-9_-]{16,60}$/.test(invite)) {
        await deps.kv.set(`bot:pending-invite:${from.id}`, invite, 60 * 60);
      }
      await ctx.reply(copy.welcome, { reply_markup: shareKeyboard() });
      return;
    }
    if (invite) await family.openInvite(ctx, invite);
    else await ctx.reply(copy.protected, { parse_mode: 'HTML' });
  }

  /** A company invited its customers: welcome them in its name, and credit it if they join. */
  async function companyInvite(ctx: Context, code: string) {
    const from = ctx.from;
    if (!from) return;
    const company = /^[A-Za-z0-9]{10}$/.test(code) ? await deps.businesses.findByInviteCode(code) : null;
    const person = await deps.people.byTelegramId(from.id);
    if (!company || company.status !== 'active') {
      // An unknown or suspended company's link: just the normal start.
      await ctx.reply(person ? copy.protected : copy.welcome, {
        parse_mode: 'HTML',
        ...(person ? {} : { reply_markup: shareKeyboard() }),
      });
      return;
    }
    if (person) {
      await ctx.reply(copy.invitedAlready(company.legalName), { parse_mode: 'HTML' });
      return;
    }
    await deps.kv.set(`bot:invited-by:${from.id}`, company.id, 24 * 60 * 60);
    await ctx.reply(copy.invitedWelcome(company.legalName), {
      parse_mode: 'HTML',
      reply_markup: shareKeyboard(),
    });
  }

  /** "Is this call real?" (plan §7.3): green with company + code if an open seal exists, else red. */
  async function check(ctx: Context) {
    const from = ctx.from;
    if (!from) return;
    const person = await deps.people.byTelegramId(from.id);
    if (!person) {
      await ctx.reply(copy.needNumber, { reply_markup: shareKeyboard() });
      return;
    }
    if (await limited(`check:${from.id}`, 10, 600)) {
      await ctx.reply(copy.tooManyChecks);
      return;
    }
    const open = await deps.seals.openForPhone(person.phoneHash, new Date(now()));
    if (open.length === 0) {
      await ctx.reply(copy.checkRed, {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(copy.reportButton, 'report'),
      });
      // Tell the people who protect this person (only those they allowed).
      await family
        .alertGuardians(bot, person)
        .catch((err: unknown) => console.error('[bot] guardian alert failed:', errText(err)));
      return;
    }
    const lines = open.slice(0, 3).map((row) => {
      const seal = JSON.parse(row.sealJson) as Seal;
      return copy.checkGreen({ company: seal.company.legalName, code: seal.code });
    });
    await ctx.reply(lines.join('\n\n'), { parse_mode: 'HTML' });
  }

  bot.command('start', (ctx) => start(ctx, ctx.match.trim()));
  family.register(bot);
  info.register(bot);
  bot.command('check', check);
  bot.command('help', (ctx) => ctx.reply(copy.help, { parse_mode: 'HTML' }));
  bot.command('privacy', (ctx) => ctx.reply(copy.privacy));
  bot.callbackQuery('check', async (ctx) => {
    await ctx.answerCallbackQuery();
    await check(ctx);
  });

  // Sharing a number. Only the number of THIS Telegram account is accepted (plan §5.4 B).
  bot.on('message:contact', async (ctx) => {
    const contact = ctx.message.contact;
    if (contact.user_id !== ctx.from.id) {
      await ctx.reply(copy.notOwnContact, { parse_mode: 'HTML', reply_markup: shareKeyboard() });
      return;
    }
    const raw = contact.phone_number.trim();
    const e164 = normalizeE164(raw.startsWith('+') ? raw : `+${raw}`);
    if (!e164) {
      await ctx.reply(copy.notOwnContact, { parse_mode: 'HTML', reply_markup: shareKeyboard() });
      return;
    }
    const invitedBy = await deps.kv.take(`bot:invited-by:${ctx.from.id}`);
    await deps.people.register({
      tgUserId: ctx.from.id,
      chatId: ctx.chat.id,
      phoneHash: phoneHash(deps.phonePepper, e164),
      phoneEnc: deps.phoneCipher.encrypt(e164),
      lang: 'en',
      invitedByBusinessId: invitedBy,
    });
    await ctx.reply(copy.protected, { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } });
    // They came from a family invite link: continue it now.
    const pending = await deps.kv.take(`bot:pending-invite:${ctx.from.id}`);
    if (pending) await family.openInvite(ctx, pending);
  });

  bot.callbackQuery('report', async (ctx) => {
    await ctx.answerCallbackQuery();
    const person = await deps.people.byTelegramId(ctx.from.id);
    if (!person) return;
    if (await limited(`report:${ctx.from.id}`, 5, 3600)) {
      await ctx.reply(copy.tooManyChecks);
      return;
    }
    const created = await deps.reports.create(
      {
        personId: person.id,
        phoneHash: person.phoneHash,
        sealId: null,
        reason: 'unverified_call',
        claimedCompany: null,
      },
      new Date(now()),
    );
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    // Ask who the caller claimed to be (10 minutes to answer). Their answer powers the "never calls"
    // warning, the guardian's alert and the company's "scam calls using your name" count.
    await deps.kv.set(`bot:claim:${ctx.from.id}`, created.id, 600);
    await ctx.reply(copy.reportAskWho, {
      reply_markup: new InlineKeyboard().text(copy.claimSkip, 'claim:skip'),
    });
  });

  bot.callbackQuery('claim:skip', async (ctx) => {
    await ctx.answerCallbackQuery();
    await deps.kv.take(`bot:claim:${ctx.from.id}`);
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    await ctx.reply(copy.reported);
  });

  // /stop really deletes (plan §21). Confirm first.
  bot.command('stop', async (ctx) => {
    if (!(await deps.people.byTelegramId(ctx.from?.id ?? 0))) {
      await ctx.reply(copy.notRegistered);
      return;
    }
    await ctx.reply(copy.stopConfirm, {
      reply_markup: new InlineKeyboard().text(copy.stopYes, 'stop:yes').text(copy.stopNo, 'stop:no'),
    });
  });
  bot.callbackQuery('stop:yes', async (ctx) => {
    await ctx.answerCallbackQuery();
    await deps.people.deleteByTelegramId(ctx.from.id);
    await ctx.editMessageText(copy.stopDone).catch(() => ctx.reply(copy.stopDone));
  });
  bot.callbackQuery('stop:no', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(copy.stopKept).catch(() => ctx.reply(copy.stopKept));
  });

  // The answer to "Who did the caller say they were?" (only while that question is open).
  // Registered after every command, so commands always win.
  bot.on('message:text', async (ctx, next) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return next();
    const reportId = await deps.kv.take(`bot:claim:${ctx.from.id}`);
    if (!reportId) return next();
    const person = await deps.people.byTelegramId(ctx.from.id);
    if (!person) return;
    const claimed = cleanClaimedName(text);
    if (!claimed) {
      await ctx.reply(copy.reported);
      return;
    }
    const candidates = (await deps.businesses.searchByName(claimed, 5)).filter((b) => b.status === 'active');
    const match = matchClaimedCompany(claimed, candidates);
    await deps.reports.claim(reportId, person.id, claimed, match?.id ?? null);
    const reply = !match
      ? copy.claimUnknown(claimed)
      : match.neverCalls
        ? copy.claimNeverCalls(match.legalName)
        : copy.claimVerifiedNotCalling(match.legalName);
    await ctx.reply(reply, { parse_mode: 'HTML' });
    await family
      .alertGuardiansClaimed(bot, person, match?.legalName ?? claimed)
      .catch((err: unknown) => console.error('[bot] guardian alert failed:', errText(err)));
  });

  bot.catch((err) => {
    console.error(`[bot] error while handling update ${err.ctx.update.update_id}:`, errText(err.error));
  });

  return bot;
}

export const BOT_COMMANDS = [
  { command: 'check', description: 'Is this call real?' },
  { command: 'family', description: 'Protect someone you love' },
  { command: 'history', description: 'My last sealed calls' },
  { command: 'company', description: 'Is a company verified?' },
  { command: 'consent', description: 'Who may call me' },
  { command: 'help', description: 'What I do' },
  { command: 'privacy', description: 'What I store' },
  { command: 'stop', description: 'Delete my data' },
];

export async function startBotPolling(
  bot: Bot,
  options: { miniAppUrl?: string | undefined } = {},
): Promise<void> {
  await bot.init();
  await bot.api
    .setMyCommands(BOT_COMMANDS)
    .catch((err: unknown) => console.error('[bot] setMyCommands failed:', errText(err)));
  // The chat's menu button opens the Mini App; without one, it shows the command list again
  // (so an old, dead tunnel address never stays on people's screens).
  await bot.api
    .setChatMenuButton({
      menu_button: options.miniAppUrl
        ? { type: 'web_app', text: copy.menuButton, web_app: { url: `${options.miniAppUrl}/tg` } }
        : { type: 'commands' },
    })
    .catch((err: unknown) => console.error('[bot] setChatMenuButton failed:', errText(err)));
  if (options.miniAppUrl) console.log(`[bot] Mini App: ${options.miniAppUrl}/tg`);
  console.log(`[bot] @${bot.botInfo.username} connected (long polling)`);
  // Don't await: start() resolves only when the bot stops.
  // Keep messages that arrived while the server was restarting: dropping them would silently
  // swallow a person's /check during a scam call.
  //
  // Never give up: during a redeploy the new server starts while the old one is still polling, and
  // Telegram refuses a second copy (409) for those few seconds. Giving up then left NO bot running
  // once the old copy stopped. So retry, waiting a little longer each time (5 s up to 60 s).
  let wait = 5_000;
  const run = (): void => {
    bot
      .start({
        drop_pending_updates: false,
        onStart: () => {
          wait = 5_000;
        },
      })
      .catch((err: unknown) => {
        const conflict = (err as { error_code?: number } | null)?.error_code === 409;
        console.error(
          conflict
            ? `[bot] another copy of this bot is polling (normal for a few seconds during a redeploy; or a second "pnpm dev"). Retrying in ${wait / 1000} s.`
            : `[bot] polling stopped with an error: ${errText(err)}. Retrying in ${wait / 1000} s.`,
        );
        setTimeout(run, wait).unref();
        wait = Math.min(wait * 2, 60_000);
      });
  };
  run();
}

/** A company name typed by a person: one line, no control characters, at most 60 characters. */
export function cleanClaimedName(text: string): string | null {
  const one = text
    // Deliberately matches control and invisible direction characters, to remove them from typed text.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (one.length < 2) return null;
  return one.length > 60 ? one.slice(0, 60).trim() : one;
}

const COMPANY_SUFFIX =
  /\b(b\.?v\.?|n\.?v\.?|ltd|limited|inc|llc|plc|gmbh|ag|s\.?a\.?|pvt|private|co|corp)\b\.?/g;
const normalizeCompany = (s: string) =>
  s
    .toLowerCase()
    .replace(COMPANY_SUFFIX, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Which verified company the caller pretended to be. Exact name (ignoring case, punctuation and
 * "BV/Ltd/Inc…") wins; otherwise only a single candidate that starts with the typed name. Anything
 * ambiguous ("Bank" matching several) is no match: never guess the wrong company.
 */
export function matchClaimedCompany<T extends { legalName: string }>(
  typed: string,
  candidates: T[],
): T | null {
  const q = normalizeCompany(typed);
  if (!q) return null;
  const exact = candidates.filter((c) => normalizeCompany(c.legalName) === q);
  if (exact.length === 1) return exact[0] ?? null;
  if (exact.length > 1) return null;
  const starts = candidates.filter((c) => normalizeCompany(c.legalName).startsWith(`${q} `));
  return starts.length === 1 ? (starts[0] ?? null) : null;
}
