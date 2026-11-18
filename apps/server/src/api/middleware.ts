import type { MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { KvStore } from '../infra/kv';
import { apiError } from './errors';

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

export function clientIp(c: Parameters<MiddlewareHandler>[0], trustProxy: boolean): string {
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

/** Fixed-window rate limit per client IP. */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const ip = clientIp(c, options.trustProxy);
    const window = Math.floor(Date.now() / 1000 / options.windowSeconds);
    const count = await options.kv.incr(`rl:${options.name}:${ip}:${window}`, options.windowSeconds);
    if (count > options.limit) {
      c.header('Retry-After', String(options.windowSeconds));
      return apiError(c, 'rate_limited');
    }
    return next();
  };
}
