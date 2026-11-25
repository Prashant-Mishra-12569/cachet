import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isNetwork, type Network } from '@cachet/shared';

const ROOT_ENV = fileURLToPath(new URL('../.env', import.meta.url));

/** Load the repo-root .env (if present) without overriding variables already set. */
export function loadRootEnv(): void {
  if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);
}

/** Cachet API for the command-line tools: CACHET_API_URL (e.g. https://api.getcachet.site) or local. */
export function apiBase(): string {
  const url = process.env['CACHET_API_URL']?.trim();
  return (url || `http://localhost:${process.env['PORT'] ?? '8787'}`).replace(/\/+$/, '');
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

/** Thrown by fail() to stop a script after its message was printed. */
class ScriptStop extends Error {}

/**
 * Print an error in plain words and stop the script with exit code 1.
 * No process.exit(): exiting while network handles are still closing crashes Node 24 on Windows
 * ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"). Node exits by itself once idle.
 */
export function fail(err: unknown): never {
  if (!(err instanceof ScriptStop)) console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
  throw err instanceof ScriptStop ? err : new ScriptStop();
}

/** Use as `main().catch(stop)`: reports the error (once) and sets exit code 1, without throwing. */
export function stop(err: unknown): void {
  if (!(err instanceof ScriptStop)) console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
