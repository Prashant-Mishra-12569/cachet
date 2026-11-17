import { serve } from '@hono/node-server';
import pkg from '../package.json' with { type: 'json' };
import { createApp } from './api/app';
import { createBot, startBotPolling } from './bot/bot';
import { loadEnv } from './env';
import { FACILITATOR_READY } from './facilitator/index';
import { WORKER_READY } from './worker/index';

const env = loadEnv();

const app = createApp({ network: env.CCD_NETWORK, version: pkg.version });
const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port} (${env.CCD_NETWORK})`);
});

const bot = env.TELEGRAM_BOT_TOKEN ? createBot(env.TELEGRAM_BOT_TOKEN) : undefined;
if (bot) {
  startBotPolling(bot).catch((err: unknown) => {
    console.error('[bot] could not start. Check TELEGRAM_BOT_TOKEN in .env.', err);
  });
} else {
  console.log('[bot] skipped: TELEGRAM_BOT_TOKEN is not set in .env');
}

console.log(`[facilitator] ${FACILITATOR_READY ? 'ready' : 'not built yet (Phase 2)'}`);
console.log(`[worker] ${WORKER_READY ? 'ready' : 'not built yet (Phase 2)'}`);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received, shutting down…`);
  if (bot?.isRunning()) await bot.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
