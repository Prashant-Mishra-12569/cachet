import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isNetwork, type Network } from '@cachet/shared';

const ROOT_ENV = fileURLToPath(new URL('../.env', import.meta.url));

/** Load the repo-root .env (if present) without overriding variables already set. */
export function loadRootEnv(): void {
  if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);
}

export function network(): Network {
  const value = process.env['CCD_NETWORK'] ?? 'testnet';
  if (!isNetwork(value)) throw new Error(`CCD_NETWORK must be "testnet" or "mainnet", got "${value}"`);
  return value;
}

export function optionalPort(): number | undefined {
  const raw = process.env['CCD_GRPC_PORT'];
  if (!raw) return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535)
    throw new Error('CCD_GRPC_PORT is not a valid port');
  return port;
}

/** Print an error in plain words and exit non-zero. */
export function fail(err: unknown): never {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
