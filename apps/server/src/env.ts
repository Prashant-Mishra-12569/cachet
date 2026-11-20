import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { normalizeAccountAddress } from '@cachet/concordium';
import { NETWORKS } from '@cachet/shared';

const ROOT_ENV = fileURLToPath(new URL('../../../.env', import.meta.url));

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

/** Optional account address; if set, it must pass the address checksum (catches copy/paste damage). */
const optionalAccount = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .optional()
    .refine((v) => v === undefined || normalizeAccountAddress(v) !== undefined, {
      message: 'is not a valid Concordium address (checksum failed). Copy it again from the wallet.',
    }),
);

const booleanFlag = z.preprocess(
  (v) => (typeof v === 'string' ? ['1', 'true', 'yes'].includes(v.trim().toLowerCase()) : v),
  z.boolean().default(false),
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  /** The website origin (scheme + host + port). Only this origin may call cookie-based endpoints. */
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  /** Set to true when running behind a proxy that sets X-Forwarded-For (Railway, Fly). */
  TRUST_PROXY: booleanFlag,
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  DATABASE_URL: z.string().min(1).default('postgres://cachet:cachet@localhost:5432/cachet'),

  /** Concordium Credential Verification Service (Verify & Access). */
  VERIFIER_URL: z.url().default('http://localhost:8000'),
  VERIFIER_HEALTH_URL: z.url().default('http://localhost:8001/health'),
  /** Identity provider indexes trusted to issue COMPANY identities. Testnet: 4 = Global FinReg. */
  COMPANY_ID_ISSUERS: z
    .string()
    .default('4')
    .transform((v) => v.split(',').map((s) => Number(s.trim())))
    .refine((list) => list.length > 0 && list.every((n) => Number.isInteger(n) && n >= 0), {
      message: 'must be a comma-separated list of identity provider numbers, e.g. "4"',
    }),

  CCD_NETWORK: z.enum(NETWORKS).default('testnet'),
  CCD_GRPC_HOST: optionalString,
  CCD_GRPC_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  CCD_COMPANY_ADDRESS: optionalAccount,
  CCD_AGENT_ADDRESS: optionalAccount,
  CCD_SPONSOR_ADDRESS: optionalAccount,
  CACHET_TREASURY_ADDRESS: optionalAccount,
  CCD_PERSON_ADDRESS: optionalAccount,
  CCD_FACILITATOR_ADDRESS: optionalAccount,
  CCD_VERIFIER_ADDRESS: optionalAccount,

  TELEGRAM_BOT_TOKEN: optionalString,
  /**
   * Public https address of the website for the Telegram Mini App (Telegram only opens https).
   * Local testing: a tunnel to http://localhost:3000. Empty = no Mini App buttons.
   */
  MINIAPP_URL: z.preprocess(
    emptyToUndefined,
    z
      .url()
      .optional()
      .refine((v) => v === undefined || v.startsWith('https://'), {
        message: 'must start with https:// (Telegram only opens Mini Apps over https)',
      })
      .transform((v) => v?.replace(/\/+$/, '')),
  ),

  /** Seal secrets: generate with `pnpm gen-secrets`. */
  SEAL_SIGNING_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'missing or malformed. Run "pnpm gen-secrets".'),
  CALL_CODE_SECRET: z.string().min(32, 'missing. Run "pnpm gen-secrets".'),
  PHONE_PEPPER: z.string().min(32, 'missing. Run "pnpm gen-secrets". Never change it once set.'),
  /** AES-256 key for phone numbers people share with the bot (64 hex). */
  PHONE_ENC_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'missing or malformed. Run "pnpm gen-secrets".'),
  /** Anchor the ledger when the oldest item is this old (plan: 5 minutes). */
  ANCHOR_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(300),
  CCD_SPONSOR_KEY_PATH: optionalString,
  /** The Protocol-Level Token used for payments (EUDemo on testnet). */
  PLT_TOKEN_ID: z.string().min(1).default('EUDemo'),
  /** Decimals of that token (EUDemo: 6). Checked against the chain at start-up. */
  PLT_DECIMALS: z.coerce.number().int().min(0).max(18).default(6),

  /** Concordium Agent Registry service (REST + MCP). */
  AGENT_REGISTRY_API: z.url().default('https://agent-registry-mcp.concordium.com'),
  /** GitHub token with ONLY the "gist" scope: temporary public hosting for Agent Cards. */
  GIST_TOKEN: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;

/** Load the repo-root .env (never overriding real environment variables) and validate it. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env && existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid settings in .env:\n${problems}`);
  }
  return parsed.data;
}
