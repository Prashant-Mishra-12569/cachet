/**
 * Build the Railway variables for a service from the local .env and put them on the CLIPBOARD
 * (never printed). Paste into Railway → service → Variables → Raw Editor.
 *
 *   pnpm deploy:env server      (Cachet server; production values + references to Postgres/Redis/verifier)
 *   pnpm deploy:env verifier    (Concordium verifier: its key + node endpoint)
 *
 * Secrets that existing data depends on (PHONE_PEPPER, PHONE_ENC_KEY, SEAL_SIGNING_KEY, …) are copied
 * byte for byte from .env, so the copied database keeps working.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const ROOT_ENV = new URL('../.env', import.meta.url);
const DOMAIN = process.env.CACHET_DOMAIN ?? 'getcachet.site';

/** Settings copied as they are in .env (only when set there). */
const SERVER_FROM_ENV = [
  'CCD_NETWORK',
  'CCD_GRPC_HOST',
  'CCD_GRPC_PORT',
  'CCD_COMPANY_ADDRESS',
  'CCD_AGENT_ADDRESS',
  'CCD_SPONSOR_ADDRESS',
  'CACHET_TREASURY_ADDRESS',
  'CCD_PERSON_ADDRESS',
  'CCD_FACILITATOR_ADDRESS',
  'CCD_VERIFIER_ADDRESS',
  'PLT_TOKEN_ID',
  'PLT_DECIMALS',
  'COMPANY_ID_ISSUERS',
  'AGENT_REGISTRY_API',
  'X402_FACILITATOR',
  'X402_FACILITATOR_URL',
  'X402_FACILITATOR_API_KEY',
  'X402_FACILITATOR_AUTH',
  'SEAL_PRICE',
  'ANCHOR_INTERVAL_SECONDS',
  'W3ID_REGISTRY',
  'TELEGRAM_BOT_TOKEN',
  'GIST_TOKEN',
  // Existing data depends on these: they must be identical to the database's origin.
  'SEAL_SIGNING_KEY',
  'CALL_CODE_SECRET',
  'PHONE_PEPPER',
  'PHONE_ENC_KEY',
  'SESSION_SECRET',
];

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!existsSync(ROOT_ENV)) fail('No .env found in the repo root.');
const env = parseEnv(readFileSync(ROOT_ENV, 'utf8'));
const b64File = (name) => {
  const path = env[name];
  if (!path || !existsSync(path)) fail(`${name} must point to the key file in .env.`);
  return readFileSync(path).toString('base64');
};

const which = process.argv[2];
const vars = new Map();
if (which === 'server') {
  for (const name of SERVER_FROM_ENV) if (env[name]?.trim()) vars.set(name, env[name].trim());
  for (const must of [
    'PHONE_PEPPER',
    'PHONE_ENC_KEY',
    'SEAL_SIGNING_KEY',
    'CALL_CODE_SECRET',
    'TELEGRAM_BOT_TOKEN',
  ]) {
    if (!vars.has(must)) fail(`${must} is empty in .env.`);
  }
  // Build with OUR Dockerfile (otherwise Railway's auto-builder guesses, and fails on the monorepo).
  vars.set('RAILWAY_DOCKERFILE_PATH', 'apps/server/Dockerfile');
  // Fixed port, matching the custom domain's target port (Railway would otherwise pick 8080).
  vars.set('PORT', '8787');
  vars.set('NODE_ENV', 'production');
  vars.set('TRUST_PROXY', 'true');
  vars.set('WEB_ORIGIN', `https://${DOMAIN}`);
  vars.set('MINIAPP_URL', `https://${DOMAIN}`);
  vars.set('DATABASE_URL', '${{Postgres.DATABASE_URL}}');
  vars.set('REDIS_URL', '${{Redis.REDIS_URL}}');
  vars.set('VERIFIER_URL', 'http://${{verifier.RAILWAY_PRIVATE_DOMAIN}}:8000');
  vars.set('VERIFIER_HEALTH_URL', 'http://${{verifier.RAILWAY_PRIVATE_DOMAIN}}:8001/health');
  vars.set('CCD_SPONSOR_KEY_B64', b64File('CCD_SPONSOR_KEY_PATH'));
} else if (which === 'verifier') {
  vars.set('RAILWAY_DOCKERFILE_PATH', 'infra/verifier/Dockerfile');
  vars.set('VERIFIER_KEY_B64', b64File('CCD_VERIFIER_KEY_PATH'));
  vars.set(
    'CREDENTIAL_VERIFICATION_SERVICE_NODE_GRPC_ENDPOINT',
    env.VERIFIER_NODE_GRPC_ENDPOINT?.trim() || 'https://grpc.testnet.concordium.com:20000',
  );
} else {
  fail('usage: pnpm deploy:env server|verifier');
}

const block = [...vars].map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
if (process.platform !== 'win32') fail('Clipboard copy is set up for Windows (clip.exe) only.');
const clip = spawnSync('clip', { input: block });
if (clip.status !== 0) fail('Could not copy to the clipboard.');
console.log(`✓ ${vars.size} variables for "${which}" are on your clipboard (values not shown):`);
console.log(`  ${[...vars.keys()].join(', ')}`);
console.log('  Paste them into Railway → the service → Variables → Raw Editor, then clear your clipboard.');
