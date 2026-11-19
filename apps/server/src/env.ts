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

  /** Seal secrets: generate with `pnpm gen-secrets`. */
  SEAL_SIGNING_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'missing or malformed. Run "pnpm gen-secrets".'),
  CALL_CODE_SECRET: z.string().min(32, 'missing. Run "pnpm gen-secrets".'),
  PHONE_PEPPER: z.string().min(32, 'missing. Run "pnpm gen-secrets". Never change it once set.'),
  /** The Protocol-Level Token used for payments (EUDemo on testnet). */
  PLT_TOKEN_ID: z.string().min(1).default('EUDemo'),

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
