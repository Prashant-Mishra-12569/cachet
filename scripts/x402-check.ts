/**
 * Check the hosted x402 facilitator (Concordium testnet) with the key from .env. Never prints the key.
 * Finds out how the key must be sent and what the facilitator supports (networks, fee payer).
 *
 *   pnpm x402:check
 */
import { fail, loadRootEnv, stop } from './env';

async function main(): Promise<void> {
  loadRootEnv();
  const url = process.env['X402_FACILITATOR_URL']?.replace(/\/+$/, '');
  const key = process.env['X402_FACILITATOR_API_KEY']?.trim();
  if (!url || !key) fail('Fill X402_FACILITATOR_URL and X402_FACILITATOR_API_KEY in .env first.');
  console.log(`Facilitator: ${url}  (key: ${key.length} characters)`);

  const styles = {
    bearer: { Authorization: `Bearer ${key}` },
    'x-api-key': { 'X-API-Key': key },
  } as const;
  for (const [name, headers] of Object.entries(styles)) {
    const res = await fetch(`${url}/supported`, { headers }).catch(() => null);
    if (!res) fail(`can't reach ${url}`);
    console.log(`  ${name.padEnd(10)} → HTTP ${res.status}`);
    if (res.ok) {
      const body = (await res.json()) as { kinds?: { scheme: string; network: string; extra?: unknown }[] };
      for (const k of body.kinds ?? []) {
        console.log(`    supports ${k.scheme} on ${k.network} ${k.extra ? JSON.stringify(k.extra) : ''}`);
      }
      console.log(`\n✓ Works. In .env set:  X402_FACILITATOR_AUTH=${name}`);
      console.log(
        '  To use it instead of our own facilitator:  X402_FACILITATOR=hosted  (then restart pnpm dev)',
      );
      return;
    }
  }
  fail('the facilitator refused the key both ways. Check X402_FACILITATOR_API_KEY (no quotes, no spaces).');
}

main().catch(stop);
