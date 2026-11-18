import { serve } from '@hono/node-server';
import { createGrpcClient, verifyAccountMessage } from '@cachet/concordium';
import pkg from '../package.json' with { type: 'json' };
import { createApp } from './api/app';
import { createAuthService } from './auth/service';
import { createBot, startBotPolling } from './bot/bot';
import { loadEnv } from './env';
import { FACILITATOR_READY } from './facilitator/index';
import { createRedisKv } from './infra/kv';
import { WORKER_READY } from './worker/index';

let env;
try {
  env = loadEnv();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const kv = await createRedisKv(env.REDIS_URL).catch((err: unknown) => {
  console.error(
    `[redis] cannot connect to ${env.REDIS_URL}. Is Docker running? Try "pnpm db:up".`,
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});

const grpc = createGrpcClient({ network: env.CCD_NETWORK, host: env.CCD_GRPC_HOST, port: env.CCD_GRPC_PORT });

const auth = createAuthService({
  kv,
  network: env.CCD_NETWORK,
  webOrigin: env.WEB_ORIGIN,
  verifyMessage: (address, message, signature) => verifyAccountMessage(grpc, address, message, signature),
});

const app = createApp({
  network: env.CCD_NETWORK,
  version: pkg.version,
  kv,
  auth,
  webOrigin: env.WEB_ORIGIN,
  secureCookies: env.NODE_ENV === 'production',
  trustProxy: env.TRUST_PROXY,
});

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
  setTimeout(() => process.exit(0), 3_000).unref();
  if (bot?.isRunning()) await bot.stop();
  await kv.close().catch(() => undefined);
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
