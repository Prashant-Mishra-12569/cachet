/**
 * Live seal test against a RUNNING server (pnpm dev), on testnet, acting as the AI caller:
 * sign a seal request with the agent's key → get a seal + call code → replay must fail →
 * public view → close the seal when the "call" ends.
 * Needs at least one seal credit for the agent.
 *
 *   pnpm seal:smoke <badge> <calleeE164> [fromE164] [--keep-open]
 *
 * --keep-open: don't close the seal (so the bot's /check shows green for up to 15 minutes).
 */
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { signMessage } from '@concordium/web-sdk';
import { loadAccountKey } from '@cachet/concordium';
import { canonicalize, sealCloseMessage, sealRequestMessage, sha256Hex } from '@cachet/shared/seal';
import { decodePaymentResponseHeader } from '@x402/fetch';
import { explorerTxUrl } from '@cachet/shared';
import { fail, stop, loadRootEnv, network, apiBase } from './env';
import { agentPayingFetch } from './x402-client';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

async function main(): Promise<void> {
  loadRootEnv();
  const args = process.argv.slice(2);
  const keepOpen = args.includes('--keep-open');
  const [badge, to, from = to] = args.filter((a) => !a.startsWith('--'));
  if (!badge || !to) fail('usage: pnpm seal:smoke <badge> <calleeE164> [fromE164] [--keep-open]');
  const api = apiBase();
  const path = process.env['CCD_AGENT_KEY_PATH'];
  const account = process.env['CCD_AGENT_ADDRESS'];
  if (!path || !account) fail('CCD_AGENT_KEY_PATH and CCD_AGENT_ADDRESS must be set in .env');
  const key = await loadAccountKey({
    path,
    expectedAddress: account,
    network: network(),
    forbiddenDir: REPO_ROOT,
  });

  /** Sign like the AI's SDK will: the wallet message scheme over sha256(JCS(request)). */
  async function signed(request: Record<string, unknown>, message: (d: string) => string) {
    const digest = sha256Hex(canonicalize(request));
    return { request, signature: await signMessage(key.address, message(digest), key.signer) };
  }
  const post = async (route: string, body: unknown) => {
    const res = await fetch(`${api}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { res, json: (await res.json()) as Record<string, unknown> };
  };
  const now = () => Math.floor(Date.now() / 1000);

  const sealBody = await signed(
    {
      v: 'cachet-seal-request/1',
      badge,
      agentAccount: account,
      to,
      from,
      purpose: 'billing',
      message: 'Your November bill is ready',
      amount: { value: '12.40', asset: process.env['PLT_TOKEN_ID'] ?? 'EUDemo' },
      nonce: randomBytes(16).toString('hex'),
      ts: now(),
    },
    sealRequestMessage,
  );
  // Like the real SDK: if the AI caller has no seal credits left, the server answers 402 (x402) and
  // this fetch pays €0.01 for this one seal by itself, then sends the same request again.
  const { fetch: payingFetch } = await agentPayingFetch();
  const started = Date.now();
  const issuedRes = await payingFetch(`${api}/v1/seals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sealBody),
  });
  const issued = { res: issuedRes, json: (await issuedRes.json()) as Record<string, unknown> };
  const ms = Date.now() - started;
  const x402Receipt = issuedRes.headers.get('PAYMENT-RESPONSE');
  if (x402Receipt) {
    const settled = decodePaymentResponseHeader(x402Receipt);
    console.log(
      `✓ no credits left: paid this seal with x402 → ${explorerTxUrl(network(), settled.transaction)}`,
    );
  }
  if (issued.res.status !== 201) {
    const code = (issued.json['error'] as { code?: string } | undefined)?.code;
    const hint =
      code === 'consent_revoked'
        ? '\n  This number blocked the company in Telegram (that is the block working).' +
          '\n  To undo: send /consent to the bot and tap "Allow".'
        : code === 'payment_required'
          ? '\n  The agent has no seal credits left.'
          : '';
    fail(`seal refused: HTTP ${issued.res.status} ${JSON.stringify(issued.json)}${hint}`);
  }
  console.log(`✓ seal issued in ${ms} ms`);
  console.log(`    code:       ${String(issued.json['code'])}`);
  console.log(`    first line: ${String(issued.json['firstLine'])}`);
  console.log(`    verify:     ${String(issued.json['verifyUrl'])}`);
  console.log(`    credits left: ${String(issued.json['creditsLeft'])}`);

  const replay = await post('/v1/seals', sealBody);
  if (replay.res.status !== 409) fail(`replay should be refused, got ${replay.res.status}`);
  console.log('✓ the same signed request cannot be used twice');

  const sealId = String(issued.json['sealId']);
  const view = (await (await fetch(`${api}/v1/seals/${sealId}`)).json()) as Record<string, unknown>;
  console.log(
    `✓ public view: status=${String(view['status'])} signatureValid=${String(view['signatureValid'])} company=${JSON.stringify((view['company'] as Record<string, unknown>)['legalName'])}`,
  );
  if (JSON.stringify(view).includes(String(issued.json['code']).replace('-', '')))
    fail('public view leaks the code');

  if (keepOpen) {
    console.log('✓ seal left OPEN (--keep-open): try /check in the bot now. It expires in 15 minutes.');
    return;
  }

  const closed = await post(
    `/v1/seals/${sealId}/close`,
    await signed(
      {
        v: 'cachet-seal-close/1',
        sealId,
        agentAccount: account,
        reason: 'completed',
        nonce: randomBytes(16).toString('hex'),
        ts: now(),
      },
      sealCloseMessage,
    ),
  );
  if (!closed.res.ok) fail(`close failed: HTTP ${closed.res.status} ${JSON.stringify(closed.json)}`);
  const after = (await (await fetch(`${api}/v1/seals/${sealId}`)).json()) as Record<string, unknown>;
  console.log(`✓ call ended → seal ${String(after['status'])}`);
  console.log('\nIn about 5–6 minutes this seal is in the on-chain record. Check it with:');
  console.log(`  pnpm anchor:verify ${sealId}`);
}

main().catch(stop);
