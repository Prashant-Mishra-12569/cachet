/**
 * Live check of the company-proof plumbing against a RUNNING server + verifier (pnpm dev, pnpm db:up):
 * sign in with the agent key → start a company proof (the verifier anchors the request on-chain) →
 * confirm that anchor is on testnet → send a FAKE proof and confirm it is rejected → nothing saved.
 * A real proof needs the browser wallet (manual test on /business).
 *
 *   pnpm proof:smoke
 */
import { fileURLToPath } from 'node:url';
import { signMessage, TransactionHash } from '@concordium/web-sdk';
import { createGrpcClient, loadAccountKey } from '@cachet/concordium';
import { explorerTxUrl } from '@cachet/shared';
import { fail, loadRootEnv, network, optionalPort } from './env';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

async function main(): Promise<void> {
  loadRootEnv();
  const net = network();
  const api = `http://localhost:${process.env['PORT'] ?? '8787'}`;
  const origin = process.env['WEB_ORIGIN'] ?? 'http://localhost:3000';
  const path = process.env['CCD_AGENT_KEY_PATH'];
  const address = process.env['CCD_AGENT_ADDRESS'];
  if (!path || !address) fail('CCD_AGENT_KEY_PATH and CCD_AGENT_ADDRESS must be set in .env');
  const key = await loadAccountKey({ path, expectedAddress: address, network: net, forbiddenDir: REPO_ROOT });

  let cookie = '';
  const post = async (route: string, body: unknown) => {
    const res = await fetch(`${api}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
    return { res, json: (await res.json()) as Record<string, unknown> };
  };

  // Sign in.
  const ch = await post('/v1/auth/challenge', { account: address });
  const signature = await signMessage(key.address, String(ch.json['message']), key.signer);
  const signedIn = await post('/v1/auth/verify', { challengeId: ch.json['challengeId'], account: address, signature });
  cookie = signedIn.res.headers.get('set-cookie')?.split(';')[0] ?? '';
  if (!cookie) fail('sign-in failed');
  console.log(`✓ signed in as ${address.slice(0, 6)}…`);

  // Start a company proof.
  const started = Date.now();
  const req = await post('/v1/business/proof/request', {});
  if (!req.res.ok) fail(`proof request failed: HTTP ${req.res.status} ${JSON.stringify(req.json)}`);
  const request = req.json['request'] as { transactionRef: string; subjectClaims: unknown };
  console.log(`✓ proof request created in ${Date.now() - started} ms`);
  console.log(`    asks for: ${JSON.stringify(request.subjectClaims)}`);

  // The request anchor must be on chain.
  const grpc = createGrpcClient({ network: net, host: process.env['CCD_GRPC_HOST'], port: optionalPort() });
  const outcome = await grpc.waitForTransactionFinalization(TransactionHash.fromHexString(request.transactionRef), 30_000);
  console.log(`✓ request anchor finalized on ${net} in block ${outcome.blockHash.toString().slice(0, 12)}…`);
  console.log(`    ${explorerTxUrl(net, request.transactionRef)}`);

  // A fake proof must be rejected by the real verifier.
  const fake = await post('/v1/business/proof/verify', {
    proofId: req.json['proofId'],
    presentation: {
      type: ['VerifiablePresentation', 'ConcordiumVerifiablePresentationV1'],
      presentationContext: { type: 'ConcordiumContextInformationV1', given: [], requested: [] },
      verifiableCredential: [],
      proof: { created: new Date().toISOString(), proofValue: '', type: 'ConcordiumWeakLinkingProofV1' },
    },
  });
  if (fake.res.ok) fail('a fake proof was ACCEPTED');
  console.log(`✓ fake proof rejected: HTTP ${fake.res.status} ${JSON.stringify(fake.json['error'])}`);

  // Nothing saved.
  const me = await fetch(`${api}/v1/business/me`, { headers: { cookie } });
  const meJson = (await me.json()) as { business: unknown };
  if (meJson.business !== null) fail(`expected no business, got ${JSON.stringify(meJson.business)}`);
  console.log('✓ no company was saved for this account');
}

main().catch(fail);
