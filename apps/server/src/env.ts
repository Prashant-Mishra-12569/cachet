import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { NETWORKS } from '@cachet/shared';

const ROOT_ENV = fileURLToPath(new URL('../../../.env', import.meta.url));

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  CCD_NETWORK: z.enum(NETWORKS).default('testnet'),
  TELEGRAM_BOT_TOKEN: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;

/** Load the repo-root .env (never overriding real environment variables) and validate it. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env && existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${problems}`);
  }
  return parsed.data;
}
