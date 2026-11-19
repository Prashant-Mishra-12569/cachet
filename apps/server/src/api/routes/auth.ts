import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { parseAccountSignature } from '@cachet/concordium';
import { AuthError, type AuthService } from '../../auth/service';
import type { KvStore } from '../../infra/kv';
import { apiError } from '../errors';
import { rateLimit, requireSameOrigin, sessionCookieName } from '../middleware';

export interface AuthRouteDeps {
  auth: AuthService;
  kv: KvStore;
  webOrigin: string;
  /** true in production (HTTPS): cookie gets Secure and the __Host- prefix. */
  secureCookies: boolean;
  trustProxy: boolean;
}

const ChallengeBody = z.object({ account: z.string().min(1).max(100) });
const VerifyBody = z.object({
  challengeId: z.string().min(1).max(100),
  account: z.string().min(1).max(100),
  signature: z.unknown(),
});

/** Any thrown error that isn't ours is treated as "the Concordium node is unreachable". */
function isChainError(err: unknown): boolean {
  return !(err instanceof AuthError) && !(err instanceof SyntaxError);
}

export function authRoutes(deps: AuthRouteDeps) {
  const cookieName = sessionCookieName(deps.secureCookies);
  const limiter = (name: string, limit: number) =>
    rateLimit({ kv: deps.kv, name, limit, windowSeconds: 600, trustProxy: deps.trustProxy });

  const app = new Hono();
  app.use('*', requireSameOrigin(deps.webOrigin));

  /** Step 1: get a one-time message for the wallet to sign. */
  app.post('/challenge', limiter('auth-challenge', 30), async (c) => {
    const body = ChallengeBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return apiError(c, 'invalid_request');
    try {
      return c.json(await deps.auth.createChallenge(body.data.account));
    } catch (err) {
      if (err instanceof AuthError) return apiError(c, err.code);
      throw err;
    }
  });

  /** Step 2: send back the wallet's signature; on success a session cookie is set. */
  app.post('/verify', limiter('auth-verify', 30), async (c) => {
    const body = VerifyBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return apiError(c, 'invalid_request');
    const signature = parseAccountSignature(body.data.signature);
    if (!signature) return apiError(c, 'bad_signature');

    try {
      const { token, session } = await deps.auth.verifyChallenge({
        challengeId: body.data.challengeId,
        address: body.data.account,
        signature,
      });
      setCookie(c, cookieName, token, {
        httpOnly: true,
        secure: deps.secureCookies,
        sameSite: 'Lax',
        path: '/',
        maxAge: deps.auth.sessionTtlSeconds,
      });
      return c.json({ account: session.account, expiresAt: session.expiresAt });
    } catch (err) {
      if (err instanceof AuthError) return apiError(c, err.code);
      if (isChainError(err)) {
        console.error('[auth] chain error during verify:', err instanceof Error ? err.message : err);
        return apiError(c, 'chain_unavailable');
      }
      throw err;
    }
  });

  /** Who am I? 401 if not signed in. */
  app.get('/me', async (c) => {
    const session = await deps.auth.getSession(getCookie(c, cookieName));
    if (!session) return apiError(c, 'not_signed_in');
    c.header('Cache-Control', 'no-store');
    return c.json({ account: session.account, expiresAt: session.expiresAt });
  });

  app.post('/logout', async (c) => {
    await deps.auth.endSession(getCookie(c, cookieName));
    deleteCookie(c, cookieName, { path: '/', secure: deps.secureCookies });
    return c.json({ ok: true });
  });

  return app;
}
