import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import {
  accountOfCredential,
  createGrpcClient,
  createCachedMessageVerifier,
  createRegistryClient,
  createTxSender,
  loadAccountKey,
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
import { createConsentsRepo } from './bot/consents-repo';
import { createSealDelivery } from './bot/delivery';
import { createFamilyRepo } from './bot/family-repo';
import { createPeopleRepo } from './bot/people-repo';
import { createPhoneCipher } from './bot/phone-crypto';
import { createReportsRepo } from './bot/reports-repo';
import { createCompanyProofService } from './business/company-proof';
import { createBusinessRepo } from './business/repo';
import { loadEnv } from './env';
import { webAppSecret } from './miniapp/init-data';
import { FACILITATOR_READY } from './facilitator/index';
import { createRedisKv } from './infra/kv';
import { createSealRepo } from './seals/repo';
import { createSealService } from './seals/service';
import { createVerifierClient } from './verify/verifier-client';
import { createAnchorRepo } from './worker/anchor-repo';
import { createAnchorWorker } from './worker/anchoring';

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

const anchorRepo = createAnchorRepo(database.db);
const signingKey = loadSealSigningKey(env.SEAL_SIGNING_KEY);
const agentKeys = createCachedMessageVerifier(grpc);
const sealRepo = createSealRepo(database.db);
const consentsRepo = createConsentsRepo(database.db);
const seals = createSealService({
  seals: sealRepo,
  agents: agentRepo,
  businesses: repo,
  gateway,
  verifyMessage: agentKeys,
  inclusion: (kind, refId) => anchorRepo.inclusion(kind, refId),
  consentFor: (phoneHash, businessId) => consentsRepo.statusFor(phoneHash, businessId),
  registryUrl: registry.baseUrl,
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

const people = createPeopleRepo(database.db);
const familyRepo = createFamilyRepo(database.db);

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
  ...(env.TELEGRAM_BOT_TOKEN
    ? {
        miniApp: {
          miniAppSecret: webAppSecret(env.TELEGRAM_BOT_TOKEN),
          people,
          sealRepo,
          family: familyRepo,
        },
      }
    : {}),
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

const bot = env.TELEGRAM_BOT_TOKEN
  ? createBot(env.TELEGRAM_BOT_TOKEN, {
      people,
      reports: createReportsRepo(database.db),
      seals: sealRepo,
      family: familyRepo,
      consents: consentsRepo,
      businesses: repo,
      agents: agentRepo,
      kv,
      endSealsFrom: (phoneHash, businessId) => seals.endForCallee(phoneHash, businessId, 'blocked_by_callee'),
      phoneCipher: createPhoneCipher(env.PHONE_ENC_KEY),
      phonePepper: env.PHONE_PEPPER,
    })
  : undefined;
if (bot) {
  startBotPolling(bot, { miniAppUrl: env.MINIAPP_URL }).catch((err: unknown) => {
    console.error('[bot] could not start. Check TELEGRAM_BOT_TOKEN in .env.', err);
  });
  // Seal cards: the bot hears every new / closed seal instantly (Redis pub/sub).
  await createSealDelivery({
    bot,
    kv,
    people,
    seals: sealRepo,
    webOrigin: env.WEB_ORIGIN,
    miniAppUrl: env.MINIAPP_URL,
  }).start();
} else {
  console.log('[bot] skipped: TELEGRAM_BOT_TOKEN is not set in .env');
}

console.log(`[facilitator] ${FACILITATOR_READY ? 'ready' : 'not built yet (Phase 2)'}`);
// Anchoring worker: Merkle root of new seals/closings → RegisterData on chain, paid by the sponsor.
// The sponsor's TxSender must be the ONLY sender for that account in this process (nonce safety).
if (env.CCD_SPONSOR_KEY_PATH && env.CCD_SPONSOR_ADDRESS) {
  const sponsorKey = await loadAccountKey({
    path: env.CCD_SPONSOR_KEY_PATH,
    expectedAddress: env.CCD_SPONSOR_ADDRESS,
    network: env.CCD_NETWORK,
    forbiddenDir: fileURLToPath(new URL('../../../', import.meta.url)),
  });
  const sponsor = createTxSender({
    client: grpc,
    address: env.CCD_SPONSOR_ADDRESS,
    signer: sponsorKey.signer,
  });
  const anchoring = createAnchorWorker({
    repo: anchorRepo,
    sender: sponsor,
    kv,
    intervalSeconds: env.ANCHOR_INTERVAL_SECONDS,
  });
  const anchorTick = () =>
    anchoring
      .tick()
      .catch((err: unknown) =>
        console.error('[anchor] tick failed:', err instanceof Error ? err.message : err),
      );
  setInterval(() => void anchorTick(), 30_000).unref();
  void anchorTick();
  console.log(
    `[worker] anchoring every ${env.ANCHOR_INTERVAL_SECONDS}s from sponsor ${env.CCD_SPONSOR_ADDRESS.slice(0, 6)}…`,
  );
} else {
  console.warn('[worker] anchoring disabled: set CCD_SPONSOR_KEY_PATH and CCD_SPONSOR_ADDRESS in .env');
}

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
