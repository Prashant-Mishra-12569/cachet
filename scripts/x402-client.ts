import { fileURLToPath } from 'node:url';
import { ExactConcordiumScheme } from '@x402/concordium/exact/client';
import { x402Client } from '@x402/core/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { NETWORK_CONFIG } from '@cachet/shared';
import { loadAccountKey } from '@cachet/concordium';
import { fail, network } from './env';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * fetch() for the AI caller that pays x402 "402 Payment Required" answers by itself: it builds and
 * signs the token transfer with the agent's key (Cachet's facilitator pays the fee), then retries.
 * Spend controls: only the payment token, at most `maxPerPayment` (decimal) per payment.
 */
export async function agentPayingFetch(maxPerPayment = '10') {
  const path = process.env['CCD_AGENT_KEY_PATH'];
  const account = process.env['CCD_AGENT_ADDRESS'];
  if (!path || !account) fail('CCD_AGENT_KEY_PATH and CCD_AGENT_ADDRESS must be set in .env');
  const net = network();
  const key = await loadAccountKey({ path, expectedAddress: account, network: net, forbiddenDir: REPO_ROOT });
  const caip2 = NETWORK_CONFIG[net].caip2;
  const token = process.env['PLT_TOKEN_ID'] ?? 'EUDemo';
  const decimals = Number(process.env['PLT_DECIMALS'] ?? '6');
  const [whole = '0', frac = ''] = maxPerPayment.split('.');
  const capAtomic = (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(frac.padEnd(decimals, '0') || '0')
  ).toString();

  const client = x402Client.fromConfig({
    schemes: [
      {
        network: caip2,
        client: new ExactConcordiumScheme({ accountAddress: key.address, signer: key.signer }),
      },
    ],
    // By default x402 clients only pay in tokens they know (USDR…): allow ONLY our token, capped.
    spendControls: { allowedAssets: [{ network: caip2, asset: token, maxAmountPerPayment: capAtomic }] },
  });
  return { fetch: wrapFetchWithPayment(fetch, client), account: key.address, signer: key.signer, token };
}
