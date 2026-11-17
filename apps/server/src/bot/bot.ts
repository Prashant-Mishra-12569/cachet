import { Bot } from 'grammy';

/**
 * Telegram bot. Phase 0: only proves the bot connects. The real flows (/start with contact
 * sharing, seal cards, /check …) come in Phase 3.
 * Dev uses long polling; production will switch to a webhook on the API.
 */
export function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.command('start', (ctx) =>
    ctx.reply(
      'Hi! Cachet is still being built. Soon I will tell you if an AI call is really from a company, or a scam.',
    ),
  );

  bot.catch((err) => {
    console.error(`[bot] error while handling update ${err.ctx.update.update_id}:`, err.error);
  });

  return bot;
}

export async function startBotPolling(bot: Bot): Promise<void> {
  await bot.init();
  console.log(`[bot] @${bot.botInfo.username} connected (long polling)`);
  // Don't await: start() resolves only when the bot stops.
  void bot.start({ drop_pending_updates: true });
}
