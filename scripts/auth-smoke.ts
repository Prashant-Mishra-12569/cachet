/**
 * End-to-end sign-in test against a RUNNING server (pnpm dev), on live testnet:
 * challenge → sign with the agent's wallet key (like the browser wallet would) → verify →
 * /me → logout → /me must fail. Also checks that a wrong signature is refused.
 * Signs messages only (not transactions): free, moves nothing. Never prints keys.
 *
 *   pnpm auth:smoke
 */
import { fileURLToPath } from 'node:url';
import { signMessage } from '@concordium/web-sdk';
import { loadAccountKey } from '@cachet/concordium';
import { fail, stop, loadRootEnv, network } from './env';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

async function main(): Promise<void> {
  loadRootEnv();
  const api = `http://localhost:${process.env['PORT'] ?? '8787'}`;
  const origin = process.env['WEB_ORIGIN'] ?? 'http://localhost:3000';
  const path = process.env['CCD_AGENT_KEY_PATH'];
  const address = process.env['CCD_AGENT_ADDRESS'];
  if (!path || !address) fail('CCD_AGENT_KEY_PATH and CCD_AGENT_ADDRESS must be set in .env');

  const key = await loadAccountKey({
    path,
    expectedAddress: address,
    network: network(),
    forbiddenDir: REPO_ROOT,
  });
  const post = (route: string, body: unknown, cookie?: string) =>
    fetch(`${api}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });

  // 1. A wrong signature must be refused.
  const c1 = (await (await post('/v1/auth/challenge', { account: address })).json()) as {
    challengeId: string;
    message: string;
  };
  const wrong = await signMessage(key.address, `${c1.message} (tampered)`, key.signer);
  const bad = await post('/v1/auth/verify', {
    challengeId: c1.challengeId,
    account: address,
    signature: wrong,
  });
  if (bad.status !== 401) fail(`expected 401 for a tampered signature, got ${bad.status}`);
  console.log('✓ a signature of a different message is refused (401)');

  // 2. The real flow.
  const challengeRes = await post('/v1/auth/challenge', { account: address });
  if (!challengeRes.ok) fail(`challenge failed: HTTP ${challengeRes.status} ${await challengeRes.text()}`);
  const challenge = (await challengeRes.json()) as { challengeId: string; message: string };
  console.log('✓ got a one-time sign-in message');

  const signature = await signMessage(key.address, challenge.message, key.signer);
  const verifyRes = await post('/v1/auth/verify', {
    challengeId: challenge.challengeId,
    account: address,
    signature,
  });
  if (!verifyRes.ok) fail(`verify failed: HTTP ${verifyRes.status} ${await verifyRes.text()}`);
  const cookie = verifyRes.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) fail('no session cookie returned');
  console.log(`✓ signature checked against the account's keys on ${network()}; session cookie set`);

  // 3. Replaying the same challenge must fail.
  const replay = await post('/v1/auth/verify', {
    challengeId: challenge.challengeId,
    account: address,
    signature,
  });
  if (replay.status !== 400) fail(`expected 400 for a reused challenge, got ${replay.status}`);
  console.log('✓ the same sign-in message cannot be used twice');

  const me = await fetch(`${api}/v1/auth/me`, { headers: { cookie } });
  const meBody = (await me.json()) as { account?: string };
  if (meBody.account !== address) fail(`/me returned ${JSON.stringify(meBody)}`);
  console.log(`✓ /me says signed in as ${address.slice(0, 6)}…`);

  await post('/v1/auth/logout', {}, cookie);
  const after = await fetch(`${api}/v1/auth/me`, { headers: { cookie } });
  if (after.status !== 401) fail(`expected 401 after logout, got ${after.status}`);
  console.log('✓ after logout the old cookie no longer works');
}

main().catch(stop);
