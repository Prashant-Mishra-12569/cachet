import { fileURLToPath } from 'node:url';
import { NETWORK_CONFIG } from '@cachet/shared';
import { loadAccountKey } from '@cachet/concordium';
import { createPayingFetch } from '@cachet/sdk';
import { fail, network } from './env';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * fetch() for the AI caller that pays x402 "402 Payment Required" answers by itself (see
 * createPayingFetch in @cachet/sdk): only the payment token, at most `maxPerPayment` per payment.
 */
export async function agentPayingFetch(maxPerPayment = '10') {
  const path = process.env['CCD_AGENT_KEY_PATH'];
  const account = process.env['CCD_AGENT_ADDRESS'];
  if (!path || !account) fail('CCD_AGENT_KEY_PATH and CCD_AGENT_ADDRESS must be set in .env');
  const net = network();
  const key = await loadAccountKey({ path, expectedAddress: account, network: net, forbiddenDir: REPO_ROOT });
  const token = process.env['PLT_TOKEN_ID'] ?? 'EUDemo';
  const payingFetch = createPayingFetch({
    network: NETWORK_CONFIG[net].caip2,
    account: key.address,
    signer: key.signer,
    token,
    decimals: Number(process.env['PLT_DECIMALS'] ?? '6'),
    maxPerPayment,
  });
  return { fetch: payingFetch, account: key.address, signer: key.signer, token };
}
