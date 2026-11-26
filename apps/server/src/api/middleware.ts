import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { AuthService } from '../auth/service';
import type { KvStore } from '../infra/kv';
import { apiError } from './errors';

/** Hono context for routes behind requireSession: c.var.account is the signed-in account. */
export type SessionEnv = { Variables: { account: string } };

export const sessionCookieName = (secure: boolean) => (secure ? '__Host-cachet_session' : 'cachet_session');

/** Only signed-in businesses get through; the account is put on c.var.account. */
export function requireSession(auth: AuthService, secureCookies: boolean): MiddlewareHandler<SessionEnv> {
  const cookieName = sessionCookieName(secureCookies);
  return async (c, next) => {
    const session = await auth.getSession(getCookie(c, cookieName));
    if (!session) return apiError(c, 'not_signed_in');
    c.set('account', session.account);
    return next();
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated routes: state-changing requests must come from our own
 * website (Origin header) and be JSON. Browsers always send Origin on POST, and cross-site JSON
 * requests are blocked by CORS preflight anyway; this is the second lock on the door.
 */
export function requireSameOrigin(webOrigin: string): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    if (c.req.header('origin') !== webOrigin) return apiError(c, 'forbidden_origin');
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) {
      return apiError(c, 'invalid_request');
    }
    return next();
  };
}

export interface RateLimitOptions {
  kv: KvStore;
  /** Bucket name, e.g. "auth-challenge". */
  name: string;
  limit: number;
  windowSeconds: number;
  /** When behind a trusted proxy (Vercel, Railway), use the forwarded client IP. */
  trustProxy: boolean;
}

/**
 * Requests from the website reach us through its proxy (Vercel), so the connecting IP is the proxy's,
 * shared by every visitor. The website's proxy sends the visitor's real IP plus a shared secret; we
 * believe that IP only when the secret matches. Anyone else sending these headers is ignored.
 */
export const PROXY_SECRET_HEADER = 'x-cachet-proxy-secret';
export const CLIENT_IP_HEADER = 'x-cachet-client-ip';
const proxiedIp = new WeakMap<Request, string>();

export function trustWebsiteProxy(secret: string | undefined): MiddlewareHandler {
  const want = secret ? createHash('sha256').update(secret).digest() : null;
  return async (c, next) => {
    if (want) {
      const got = c.req.header(PROXY_SECRET_HEADER);
      const ip = c.req.header(CLIENT_IP_HEADER)?.trim() ?? '';
      if (got && isIP(ip) && timingSafeEqual(createHash('sha256').update(got).digest(), want)) {
        proxiedIp.set(c.req.raw, ip);
      }
    }
    return next();
  };
}

export function clientIp(c: Parameters<MiddlewareHandler>[0], trustProxy: boolean): string {
  const viaWebsite = proxiedIp.get(c.req.raw);
  if (viaWebsite) return viaWebsite;
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown'; // e.g. in tests using app.request()
  }
}

/**
 * Fixed-window rate limit. Keyed by client IP, or by signed-in account when `byAccount` is set
 * (use that for anything that costs us money on-chain).
 */
export function rateLimit(
  options: RateLimitOptions & { byAccount?: boolean },
): MiddlewareHandler<SessionEnv> {
  return async (c, next) => {
    const who = options.byAccount ? `acct:${c.var.account}` : clientIp(c, options.trustProxy);
    const window = Math.floor(Date.now() / 1000 / options.windowSeconds);
    const count = await options.kv.incr(`rl:${options.name}:${who}:${window}`, options.windowSeconds);
    if (count > options.limit) {
      c.header('Retry-After', String(options.windowSeconds));
      return apiError(c, 'rate_limited');
    }
    return next();
  };
}
