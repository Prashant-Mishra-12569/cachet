/**
 * Checks that each key file in .env belongs to its account and really controls it on-chain.
 * Signs a throwaway message (not a transaction: free, moves nothing). Never prints key material.
 *
 *   pnpm check-keys
 */
import { fileURLToPath } from 'node:url';
import { createGrpcClient, loadAccountKey, verifyKeyOnChain } from '@cachet/concordium';
import { fail, loadRootEnv, network, optionalPort } from './env';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const PAIRS = [
  { label: 'sponsor', keyVar: 'CCD_SPONSOR_KEY_PATH', addressVar: 'CCD_SPONSOR_ADDRESS' },
  { label: 'facilitator', keyVar: 'CCD_FACILITATOR_KEY_PATH', addressVar: 'CCD_FACILITATOR_ADDRESS' },
  { label: 'agent', keyVar: 'CCD_AGENT_KEY_PATH', addressVar: 'CCD_AGENT_ADDRESS' },
  { label: 'verifier', keyVar: 'CCD_VERIFIER_KEY_PATH', addressVar: 'CCD_VERIFIER_ADDRESS' },
] as const;

async function main(): Promise<void> {
  loadRootEnv();
  const net = network();
  const client = createGrpcClient({ network: net, host: process.env['CCD_GRPC_HOST'], port: optionalPort() });

  let failures = 0;
  for (const { label, keyVar, addressVar } of PAIRS) {
    const path = process.env[keyVar]?.trim();
    const address = process.env[addressVar]?.trim();
    if (!path || !address) {
      console.log(`- ${label}: skipped (${!path ? keyVar : addressVar} is empty in .env)`);
      continue;
    }
    try {
      const key = await loadAccountKey({
        path,
        expectedAddress: address,
        network: net,
        forbiddenDir: REPO_ROOT,
      });
      const ok = await verifyKeyOnChain(client, key);
      if (!ok) throw new Error('signature does not match the on-chain account keys');
      console.log(`✓ ${label}: key file matches ${address.slice(0, 6)}… and controls it on ${net}`);
    } catch (err) {
      failures++;
      console.log(`✗ ${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failures > 0) fail(`${failures} key check(s) failed`);
}

main().catch(fail);
