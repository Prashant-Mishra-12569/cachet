/**
 * Fills EMPTY secret values in the repo-root .env with fresh random values. Never prints them and
 * never overwrites an existing value (rotating PHONE_PEPPER or CALL_CODE_SECRET would break existing data).
 *
 *   pnpm gen-secrets
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fail } from './env';

const ENV = fileURLToPath(new URL('../.env', import.meta.url));

const SECRETS: Record<string, string> = {
  SEAL_SIGNING_KEY: 'Ed25519 seed that signs every seal (public key at /.well-known/cachet-keys.json)',
  PHONE_PEPPER: 'secret for phone-number fingerprints (never rotate: stored hashes depend on it)',
  CALL_CODE_SECRET: 'secret for the 4-digit call codes',
  PHONE_ENC_KEY: 'AES-256-GCM key for phone numbers people share with the bot',
  SESSION_SECRET: 'reserved for signed cookies',
};

function main(): void {
  if (!existsSync(ENV)) fail('.env not found. Copy .env.example to .env first.');
  let text = readFileSync(ENV, 'utf8');
  const generated: string[] = [];
  const kept: string[] = [];

  for (const [name, description] of Object.entries(SECRETS)) {
    const line = new RegExp(`^${name}=(.*)$`, 'm');
    const match = line.exec(text);
    if (match && match[1]?.trim()) {
      kept.push(name);
      continue;
    }
    const value = randomBytes(32).toString('hex');
    text = match
      ? text.replace(line, `${name}=${value}`)
      : `${text.replace(/\n?$/, '\n')}# (secret) ${description}\n${name}=${value}\n`;
    generated.push(name);
  }

  writeFileSync(ENV, text, 'utf8');
  for (const name of generated) console.log(`✓ generated ${name}`);
  for (const name of kept) console.log(`- kept existing ${name}`);
}

main();
