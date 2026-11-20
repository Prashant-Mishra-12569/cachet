import { autoRetry } from '@grammyjs/auto-retry';
import { Bot, InlineKeyboard, Keyboard, type Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { normalizeE164, phoneHash, type Seal } from '@cachet/shared/seal';
import type { KvStore } from '../infra/kv';
import type { SealRepo } from '../seals/repo';
import { copy } from './copy';
import type { PeopleRepo } from './people-repo';
import type { PhoneCipher } from './phone-crypto';
import type { ReportsRepo } from './reports-repo';

export interface BotDeps {
  people: PeopleRepo;
  reports: ReportsRepo;
  seals: Pick<SealRepo, 'get' | 'openForPhone'>;
  kv: KvStore;
  phoneCipher: PhoneCipher;
  phonePepper: string;
  now?: () => number;
}

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

  async function start(ctx: Context) {
    const from = ctx.from;
    if (!from) return;
    const person = await deps.people.byTelegramId(from.id);
    if (person) await ctx.reply(copy.protected, { parse_mode: 'HTML' });
    else await ctx.reply(copy.welcome, { reply_markup: shareKeyboard() });
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
      return;
    }
    const lines = open.slice(0, 3).map((row) => {
      const seal = JSON.parse(row.sealJson) as Seal;
      return copy.checkGreen({ company: seal.company.legalName, code: seal.code });
    });
    await ctx.reply(lines.join('\n\n'), { parse_mode: 'HTML' });
  }

  bot.command('start', start);
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
    await deps.people.register({
      tgUserId: ctx.from.id,
      chatId: ctx.chat.id,
      phoneHash: phoneHash(deps.phonePepper, e164),
      phoneEnc: deps.phoneCipher.encrypt(e164),
      lang: 'en',
    });
    await ctx.reply(copy.protected, { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } });
  });

  bot.callbackQuery('report', async (ctx) => {
    await ctx.answerCallbackQuery();
    const person = await deps.people.byTelegramId(ctx.from.id);
    if (!person) return;
    if (await limited(`report:${ctx.from.id}`, 5, 3600)) {
      await ctx.reply(copy.tooManyChecks);
      return;
    }
    await deps.reports.create(
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

  bot.catch((err) => {
    console.error(`[bot] error while handling update ${err.ctx.update.update_id}:`, err.error);
  });

  return bot;
}

export const BOT_COMMANDS = [
  { command: 'check', description: 'Is this call real?' },
  { command: 'help', description: 'What I do' },
  { command: 'privacy', description: 'What I store' },
  { command: 'stop', description: 'Delete my data' },
];

export async function startBotPolling(bot: Bot): Promise<void> {
  await bot.init();
  await bot.api
    .setMyCommands(BOT_COMMANDS)
    .catch((err: unknown) => console.error('[bot] setMyCommands failed', err));
  console.log(`[bot] @${bot.botInfo.username} connected (long polling)`);
  // Don't await: start() resolves only when the bot stops.
  void bot.start({ drop_pending_updates: true });
}
