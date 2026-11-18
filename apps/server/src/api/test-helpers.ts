import { createAuthService, type VerifyMessage } from '../auth/service';
import { createMemoryKv } from '../infra/kv';
import { createApp } from './app';

export const WEB_ORIGIN = 'http://localhost:3000';
/** A real-format testnet address (public). */
export const ACCOUNT = '3dt3UMPzRASZndjmKpSWgCP2HhmoxZrgs8FDPtZjNHZzj13hhB';
export const OTHER_ACCOUNT = '35sHhKYuw7zk3iKZZjysLEh8BarcwxAJ4pQcZVB8kT9i4pkB5z';
export const SIGNATURE = { 0: { 0: 'ab'.repeat(64) } };

export function makeTestApp(options: { verifyMessage?: VerifyMessage; now?: () => number } = {}) {
  const clock = { t: Date.parse('2026-11-19T10:00:00Z') };
  const now = options.now ?? (() => clock.t);
  const kv = createMemoryKv(now);
  const auth = createAuthService({
    kv,
    network: 'testnet',
    webOrigin: WEB_ORIGIN,
    now,
    verifyMessage: options.verifyMessage ?? (async () => ({ ok: true })),
  });
  const app = createApp({
    network: 'testnet',
    version: 'test',
    kv,
    auth,
    webOrigin: WEB_ORIGIN,
    secureCookies: false,
    trustProxy: false,
  });
  return { app, kv, clock };
}

export function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB_ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}
