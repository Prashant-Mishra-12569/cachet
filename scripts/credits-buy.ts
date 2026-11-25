/**
 * Buy seal credits with x402, as the AI caller (testnet), against a RUNNING server (pnpm dev):
 *   POST /v1/credits/purchase → 402 + terms → pay (agent key signs, Cachet's facilitator pays the fee)
 *   → settled on chain → credits added.
 *
 *   pnpm credits:buy [credits=100]      (packs: 1, 10, 100, 1000; €0.01 per seal)
 */
import { decodePaymentResponseHeader } from '@x402/fetch';
import { explorerTxUrl } from '@cachet/shared';
import { fail, loadRootEnv, network, stop, apiBase } from './env';
import { agentPayingFetch } from './x402-client';

async function main(): Promise<void> {
  loadRootEnv();
  const credits = process.argv[2] ?? '100';
  if (!['1', '10', '100', '1000'].includes(credits)) fail('credits must be 1, 10, 100 or 1000');
  const api = apiBase();
  const { fetch: payingFetch } = await agentPayingFetch();

  console.log(`Buying ${credits} seal credits with x402… (settling on Concordium takes ~10 s)`);
  const started = Date.now();
  const res = await payingFetch(`${api}/v1/credits/purchase?credits=${credits}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) fail(`purchase failed: HTTP ${res.status} ${JSON.stringify(body)}`);
  const receipt = res.headers.get('PAYMENT-RESPONSE');
  const settled = receipt ? decodePaymentResponseHeader(receipt) : null;
  console.log(`✓ paid and settled in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`    credits bought: ${String(body['credits'])}, balance now: ${String(body['creditsNow'])}`);
  console.log(`    payer:          ${String(settled?.payer ?? '?')}`);
  console.log(`    x402 tx:        ${explorerTxUrl(network(), String(body['txHash']))}`);
}

main().catch(stop);
