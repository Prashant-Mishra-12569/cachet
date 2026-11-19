import { serve } from '@hono/node-server';
import {
  accountOfCredential,
  createGrpcClient,
  createCachedMessageVerifier,
  createRegistryClient,
  verifyAccountMessage,
} from '@cachet/concordium';
import { loadSealSigningKey } from '@cachet/shared/seal';
import { createDb, runMigrations } from '@cachet/db';
import pkg from '../package.json' with { type: 'json' };
import { createGistCardHost } from './agents/card-host';
import { createRegistryGateway } from './agents/registry-gateway';
import { createAgentRepo } from './agents/repo';
import { createAgentService } from './agents/service';
import { createApp } from './api/app';
import { createAuthService } from './auth/service';
import { createBot, startBotPolling } from './bot/bot';
import { createCompanyProofService } from './business/company-proof';
import { createBusinessRepo } from './business/repo';
import { loadEnv } from './env';
import { FACILITATOR_READY } from './facilitator/index';
import { createRedisKv } from './infra/kv';
import { createSealRepo } from './seals/repo';
import { createSealService } from './seals/service';
import { createVerifierClient } from './verify/verifier-client';
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

const database = createDb(env.DATABASE_URL);
try {
  await runMigrations(database);
  console.log('[db] connected, migrations up to date');
} catch (err) {
  console.error('[db] cannot connect or migrate. Is Docker running? Try "pnpm db:up".', err);
  process.exit(1);
}

const grpc = createGrpcClient({ network: env.CCD_NETWORK, host: env.CCD_GRPC_HOST, port: env.CCD_GRPC_PORT });
const verifier = createVerifierClient({ url: env.VERIFIER_URL, healthUrl: env.VERIFIER_HEALTH_URL });
const repo = createBusinessRepo(database.db);

const auth = createAuthService({
  kv,
  network: env.CCD_NETWORK,
  webOrigin: env.WEB_ORIGIN,
  verifyMessage: (address, message, signature) => verifyAccountMessage(grpc, address, message, signature),
});

const companyProof = createCompanyProofService({
  kv,
  verifier,
  repo,
  network: env.CCD_NETWORK,
  companyIssuers: env.COMPANY_ID_ISSUERS,
  accountOfCredential: (credId) => accountOfCredential(grpc, credId),
});

const registry = createRegistryClient({ baseUrl: env.AGENT_REGISTRY_API });
const cardHost = env.GIST_TOKEN ? createGistCardHost({ token: env.GIST_TOKEN }) : null;
if (!cardHost) console.warn('[agents] GIST_TOKEN not set: Agent Cards cannot be published yet.');
const agentRepo = createAgentRepo(database.db);
const gateway = createRegistryGateway({ registry, grpc, network: env.CCD_NETWORK });
const agents = createAgentService({
  agents: agentRepo,
  businesses: repo,
  gateway,
  cardHost,
  network: env.CCD_NETWORK,
});

const signingKey = loadSealSigningKey(env.SEAL_SIGNING_KEY);
const agentKeys = createCachedMessageVerifier(grpc);
const seals = createSealService({
  seals: createSealRepo(database.db),
  agents: agentRepo,
  businesses: repo,
  gateway,
  verifyMessage: agentKeys,
  prefetchAccount: agentKeys.prefetch,
  kv,
  signingKey,
  callCodeSecret: env.CALL_CODE_SECRET,
  phonePepper: env.PHONE_PEPPER,
  network: env.CCD_NETWORK,
  pltTokenId: env.PLT_TOKEN_ID,
  webOrigin: env.WEB_ORIGIN,
});
console.log(`[seals] signing key ${signingKey.kid}`);

// Keep seal issuing fast: refresh on-chain agent records + AI account keys every 10 s.
const warmSeals = () =>
  seals
    .warm()
    .catch((err: unknown) =>
      console.error('[seals] warm-up failed:', err instanceof Error ? err.message : err),
    );
await warmSeals().then((n) => typeof n === 'number' && console.log(`[seals] warmed ${n} active agent(s)`));
setInterval(() => void warmSeals(), 10_000).unref();

const app = createApp({
  network: env.CCD_NETWORK,
  version: pkg.version,
  kv,
  auth,
  repo,
  companyProof,
  agents,
  seals,
  signingKey,
  registryUrl: registry.baseUrl,
  webOrigin: env.WEB_ORIGIN,
  secureCookies: env.NODE_ENV === 'production',
  trustProxy: env.TRUST_PROXY,
  checks: { database: () => database.ping(), verifier: () => verifier.health() },
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port} (${env.CCD_NETWORK})`);
});
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[api] port ${env.PORT} is already in use. Is another "pnpm dev" still running? Stop it first.`,
    );
  } else {
    console.error('[api] server error:', err);
  }
  process.exit(1);
});

if (!(await verifier.health())) {
  console.warn(
    `[verifier] not reachable at ${env.VERIFIER_HEALTH_URL}. Company proofs won't work until it runs.`,
  );
}

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
  await database.close().catch(() => undefined);
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
