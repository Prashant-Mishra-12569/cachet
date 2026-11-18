import { describe, expect, it, vi } from 'vitest';
import type { VerifyMessage } from '../../auth/service';
import { ACCOUNT, OTHER_ACCOUNT, SIGNATURE, WEB_ORIGIN, makeTestApp, postJson } from '../test-helpers';

type Json = Record<string, unknown>;

async function getChallenge(app: ReturnType<typeof makeTestApp>['app'], account = ACCOUNT) {
  const res = await app.request(postJson('/v1/auth/challenge', { account }));
  return { res, body: (await res.json()) as Json };
}

function sessionCookie(res: Response): string {
  const header = res.headers.get('set-cookie') ?? '';
  const match = /cachet_session=([^;]+)/.exec(header);
  if (!match?.[1]) throw new Error('no session cookie');
  return `cachet_session=${match[1]}`;
}

describe('POST /v1/auth/challenge', () => {
  it('returns a readable one-time message for the account', async () => {
    const { app } = makeTestApp();
    const { res, body } = await getChallenge(app);
    expect(res.status).toBe(200);
    expect(body['challengeId']).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const message = body['message'] as string;
    expect(message).toContain('Sign in to Cachet');
    expect(message).toContain(`Account: ${ACCOUNT}`);
    expect(message).toContain(`Website: ${WEB_ORIGIN}`);
    expect(message).toContain('It is not a transaction and costs nothing.');
  });

  it('gives each request a different nonce', async () => {
    const { app } = makeTestApp();
    const a = await getChallenge(app);
    const b = await getChallenge(app);
    expect(a.body['message']).not.toBe(b.body['message']);
  });

  it('rejects an address with a broken checksum', async () => {
    const { app } = makeTestApp();
    const { res, body } = await getChallenge(app, '35sHhKDcJHrrHSgvFpsYxqb6g97uaQTd2kE31rPUeDZTeDsjVq');
    expect(res.status).toBe(400);
    expect((body['error'] as Json)['code']).toBe('invalid_account');
  });

  it('rejects requests from another website (CSRF)', async () => {
    const { app } = makeTestApp();
    const res = await app.request(
      postJson('/v1/auth/challenge', { account: ACCOUNT }, { origin: 'https://evil.example' }),
    );
    expect(res.status).toBe(403);
  });

  it('rejects non-JSON posts', async () => {
    const { app } = makeTestApp();
    const res = await app.request(
      new Request('http://localhost/v1/auth/challenge', {
        method: 'POST',
        headers: { origin: WEB_ORIGIN, 'content-type': 'text/plain' },
        body: JSON.stringify({ account: ACCOUNT }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rate-limits after 30 requests in 10 minutes', async () => {
    const { app } = makeTestApp();
    for (let i = 0; i < 30; i++) expect((await getChallenge(app)).res.status).toBe(200);
    const { res } = await getChallenge(app);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('600');
  });
});

describe('POST /v1/auth/verify', () => {
  it('signs in with a valid signature and sets a safe session cookie', async () => {
    const verifyMessage = vi.fn<VerifyMessage>(async () => ({ ok: true }));
    const { app } = makeTestApp({ verifyMessage });
    const { body: challenge } = await getChallenge(app);

    const res = await app.request(
      postJson('/v1/auth/verify', {
        challengeId: challenge['challengeId'],
        account: ACCOUNT,
        signature: SIGNATURE,
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json)['account']).toBe(ACCOUNT);

    // The server checked the exact message it issued, for the right account.
    expect(verifyMessage).toHaveBeenCalledWith(ACCOUNT, challenge['message'], SIGNATURE);

    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
  });

  it('a challenge can be used only once', async () => {
    const { app } = makeTestApp();
    const { body: challenge } = await getChallenge(app);
    const payload = { challengeId: challenge['challengeId'], account: ACCOUNT, signature: SIGNATURE };
    expect((await app.request(postJson('/v1/auth/verify', payload))).status).toBe(200);
    const second = await app.request(postJson('/v1/auth/verify', payload));
    expect(second.status).toBe(400);
    expect((((await second.json()) as Json)['error'] as Json)['code']).toBe('challenge_expired');
  });

  it('a challenge expires after 5 minutes', async () => {
    const { app, clock } = makeTestApp();
    const { body: challenge } = await getChallenge(app);
    clock.t += 5 * 60 * 1000 + 1;
    const res = await app.request(
      postJson('/v1/auth/verify', {
        challengeId: challenge['challengeId'],
        account: ACCOUNT,
        signature: SIGNATURE,
      }),
    );
    expect((((await res.json()) as Json)['error'] as Json)['code']).toBe('challenge_expired');
  });

  it('refuses a challenge made for a different account', async () => {
    const { app } = makeTestApp();
    const { body: challenge } = await getChallenge(app, ACCOUNT);
    const res = await app.request(
      postJson('/v1/auth/verify', {
        challengeId: challenge['challengeId'],
        account: OTHER_ACCOUNT,
        signature: SIGNATURE,
      }),
    );
    expect((((await res.json()) as Json)['error'] as Json)['code']).toBe('challenge_mismatch');
  });

  it('refuses a wrong signature and sets no cookie', async () => {
    const { app } = makeTestApp({ verifyMessage: async () => ({ ok: false, reason: 'bad_signature' }) });
    const { body: challenge } = await getChallenge(app);
    const res = await app.request(
      postJson('/v1/auth/verify', {
        challengeId: challenge['challengeId'],
        account: ACCOUNT,
        signature: SIGNATURE,
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('explains when the account does not exist on the network', async () => {
    const { app } = makeTestApp({ verifyMessage: async () => ({ ok: false, reason: 'account_not_found' }) });
    const { body: challenge } = await getChallenge(app);
    const res = await app.request(
      postJson('/v1/auth/verify', {
        challengeId: challenge['challengeId'],
        account: ACCOUNT,
        signature: SIGNATURE,
      }),
    );
    const error = ((await res.json()) as Json)['error'] as Json;
    expect(error['code']).toBe('account_not_found');
    expect(error['message']).toContain('Testnet');
  });

  it('rejects a malformed signature without calling the chain', async () => {
    const verifyMessage = vi.fn<VerifyMessage>(async () => ({ ok: true }));
    const { app } = makeTestApp({ verifyMessage });
    const { body: challenge } = await getChallenge(app);
    const res = await app.request(
      postJson('/v1/auth/verify', {
        challengeId: challenge['challengeId'],
        account: ACCOUNT,
        signature: 'nope',
      }),
    );
    expect(res.status).toBe(401);
    expect(verifyMessage).not.toHaveBeenCalled();
  });

  it('says "try again shortly" when the Concordium node is down', async () => {
    const { app } = makeTestApp({
      verifyMessage: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    const { body: challenge } = await getChallenge(app);
    const res = await app.request(
      postJson('/v1/auth/verify', {
        challengeId: challenge['challengeId'],
        account: ACCOUNT,
        signature: SIGNATURE,
      }),
    );
    expect(res.status).toBe(503);
  });
});

describe('session: /me and /logout', () => {
  async function signIn() {
    const ctx = makeTestApp();
    const { body: challenge } = await getChallenge(ctx.app);
    const res = await ctx.app.request(
      postJson('/v1/auth/verify', {
        challengeId: challenge['challengeId'],
        account: ACCOUNT,
        signature: SIGNATURE,
      }),
    );
    return { ...ctx, cookie: sessionCookie(res) };
  }

  it('/me returns the signed-in account', async () => {
    const { app, cookie } = await signIn();
    const res = await app.request('/v1/auth/me', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json)['account']).toBe(ACCOUNT);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('/me is 401 without a cookie or with a made-up one', async () => {
    const { app } = await signIn();
    expect((await app.request('/v1/auth/me')).status).toBe(401);
    const fake = `cachet_session=${'A'.repeat(43)}`;
    expect((await app.request('/v1/auth/me', { headers: { cookie: fake } })).status).toBe(401);
  });

  it('the session ends after 8 hours', async () => {
    const { app, cookie, clock } = await signIn();
    clock.t += 8 * 60 * 60 * 1000 + 1;
    expect((await app.request('/v1/auth/me', { headers: { cookie } })).status).toBe(401);
  });

  it('logout really ends the session on the server', async () => {
    const { app, cookie } = await signIn();
    const out = await app.request(postJson('/v1/auth/logout', {}, { cookie }));
    expect(out.status).toBe(200);
    // Even if someone kept a copy of the old cookie, it no longer works.
    expect((await app.request('/v1/auth/me', { headers: { cookie } })).status).toBe(401);
  });
});
