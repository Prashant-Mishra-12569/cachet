import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { TokenId } from '@concordium/web-sdk/plt';
import {
  accountOfCredential,
  buildSponsoredTransfer,
  createGrpcClient,
  finalizedSummary,
  findTokenTransfers,
  tokenBalanceRaw,
  transferMatches,
  createCachedMessageVerifier,
  createRegistryClient,
  createTxSender,
  loadAccountKey,
  loadAccountKeyFromBase64,
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
import { createHostedFacilitator, createLocalFacilitator } from './facilitator/index';
import { createSealBilling } from './x402/billing';
import type { FacilitatorClient } from '@x402/core/server';
import { NETWORK_CONFIG } from '@cachet/shared';
import { createRedisKv } from './infra/kv';
import { createSealRepo } from './seals/repo';
import { createPublicStats, createStatsSource } from './stats/public-stats';
import { createSealService } from './seals/service';
import { createVerifierClient } from './verify/verifier-client';
import { createAnchorRepo } from './worker/anchor-repo';
import { createAnchorWorker } from './worker/anchoring';
import { createPaymentsRepo } from './pay/repo';
import { createPayService } from './pay/service';

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
const paymentsRepo = createPaymentsRepo(database.db);
const seals = createSealService({
  paymentFor: (sealId) => paymentsRepo.forSeal(sealId),
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

// The sponsor account pays Cachet's on-chain fees: anchoring AND people's safe payments.
// Locally: a key file outside the repo. Hosted: the export's content in a secret setting (base64).
const sponsorKey = !env.CCD_SPONSOR_ADDRESS
  ? null
  : env.CCD_SPONSOR_KEY_B64
    ? loadAccountKeyFromBase64({
        base64: env.CCD_SPONSOR_KEY_B64,
        label: 'CCD_SPONSOR_KEY_B64',
        expectedAddress: env.CCD_SPONSOR_ADDRESS,
        network: env.CCD_NETWORK,
      })
    : env.CCD_SPONSOR_KEY_PATH
      ? await loadAccountKey({
          path: env.CCD_SPONSOR_KEY_PATH,
          expectedAddress: env.CCD_SPONSOR_ADDRESS,
          network: env.CCD_NETWORK,
          forbiddenDir: fileURLToPath(new URL('../../../', import.meta.url)),
        })
      : null;

// A wrong decimals setting would make every amount wrong by a factor of 10^n: check it on chain.
let decimalsOk = true;
try {
  const info = await grpc.getTokenInfo(TokenId.fromString(env.PLT_TOKEN_ID));
  if (info.state.decimals !== env.PLT_DECIMALS) {
    decimalsOk = false;
    console.error(
      `[pay] PLT_DECIMALS=${env.PLT_DECIMALS} but ${env.PLT_TOKEN_ID} has ${info.state.decimals} decimals on chain. Payments disabled.`,
    );
  }
} catch (err) {
  console.warn('[pay] could not check token decimals on chain:', err instanceof Error ? err.message : err);
}
// Safe payments (sponsored PLT transfers). A sponsored transfer uses the PAYER's nonce, so it never
// clashes with the sponsor's own anchoring transactions.
const pay =
  sponsorKey && env.CCD_SPONSOR_ADDRESS && decimalsOk
    ? createPayService({
        seals: sealRepo,
        agents: agentRepo,
        businesses: repo,
        readAgent: (tokenId) => gateway.readAgent(tokenId),
        payments: paymentsRepo,
        kv,
        pltTokenId: env.PLT_TOKEN_ID,
        decimals: env.PLT_DECIMALS,
        chain: {
          balanceRaw: (account, tokenId) => tokenBalanceRaw(grpc, account, tokenId),
          buildSponsoredTransfer: (input) =>
            buildSponsoredTransfer({
              ...input,
              client: grpc,
              sponsor: { address: env.CCD_SPONSOR_ADDRESS ?? '', signer: sponsorKey.signer },
            }),
          // Under the website proxy's time limit; the Mini App asks again while it's pending.
          finalizedSummary: (txHash) => finalizedSummary(grpc, txHash, 20_000),
        },
      })
    : undefined;
if (!pay) console.warn('[pay] safe payments disabled: set CCD_SPONSOR_KEY_PATH and CCD_SPONSOR_ADDRESS');

// x402 seal billing (plan §13.1): every seal is prepaid in the payment token, to the treasury.
const x402Network = NETWORK_CONFIG[env.CCD_NETWORK].caip2 as `${string}:${string}`;
let facilitator: FacilitatorClient | null = null;
if (env.X402_FACILITATOR === 'hosted') {
  if (env.X402_FACILITATOR_URL && env.X402_FACILITATOR_API_KEY) {
    facilitator = createHostedFacilitator({
      url: env.X402_FACILITATOR_URL,
      apiKey: env.X402_FACILITATOR_API_KEY,
      authHeader: (key) =>
        env.X402_FACILITATOR_AUTH === 'x-api-key' ? { 'X-API-Key': key } : { Authorization: `Bearer ${key}` },
    });
  } else {
    console.warn('[x402] X402_FACILITATOR=hosted needs X402_FACILITATOR_URL and X402_FACILITATOR_API_KEY');
  }
} else if (sponsorKey && env.CCD_SPONSOR_ADDRESS) {
  facilitator = createLocalFacilitator({
    network: x402Network,
    sponsor: { address: env.CCD_SPONSOR_ADDRESS, signer: sponsorKey.signer },
    grpc: {
      host: env.CCD_GRPC_HOST ?? NETWORK_CONFIG[env.CCD_NETWORK].grpcHost,
      port: env.CCD_GRPC_PORT ?? NETWORK_CONFIG[env.CCD_NETWORK].grpcPort,
    },
  });
}
const billing =
  facilitator && env.CACHET_TREASURY_ADDRESS && decimalsOk
    ? createSealBilling({
        facilitator,
        network: x402Network,
        payTo: env.CACHET_TREASURY_ADDRESS,
        asset: env.PLT_TOKEN_ID,
        decimals: env.PLT_DECIMALS,
        sealPrice: env.SEAL_PRICE,
        agents: agentRepo,
        seals: sealRepo,
        findTransfers: (search) => findTokenTransfers(grpc, search),
        confirmTransfer: (txHash, search) => transferMatches(grpc, txHash, search),
      })
    : undefined;
if (billing) {
  billing
    .init()
    .then(() =>
      console.log(
        `[x402] seal billing ready: ${env.SEAL_PRICE} ${env.PLT_TOKEN_ID} per seal → treasury ${env.CACHET_TREASURY_ADDRESS?.slice(0, 6)}…, facilitator: ${env.X402_FACILITATOR}`,
      ),
    )
    .catch((err: unknown) =>
      console.warn(
        '[x402] facilitator not reachable yet (will retry on first payment):',
        err instanceof Error ? err.message : err,
      ),
    );
} else {
  console.warn('[x402] seal billing disabled: needs a facilitator and CACHET_TREASURY_ADDRESS');
}

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
  ...(billing ? { x402: { billing, agents: agentRepo, credits: sealRepo } } : {}),
  ...(env.TELEGRAM_BOT_TOKEN
    ? {
        miniApp: {
          miniAppSecret: webAppSecret(env.TELEGRAM_BOT_TOKEN),
          people,
          sealRepo,
          family: familyRepo,
          pay,
        },
      }
    : {}),
  stats: createPublicStats({ source: createStatsSource(database.db), network: env.CCD_NETWORK }),
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
    network: env.CCD_NETWORK,
    miniAppUrl: env.MINIAPP_URL,
  }).start();
} else {
  console.log('[bot] skipped: TELEGRAM_BOT_TOKEN is not set in .env');
}

// Anchoring worker: Merkle root of new seals/closings → RegisterData on chain, paid by the sponsor.
// The sponsor's TxSender must be the ONLY sender for that account in this process (nonce safety).
if (sponsorKey && env.CCD_SPONSOR_ADDRESS) {
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
