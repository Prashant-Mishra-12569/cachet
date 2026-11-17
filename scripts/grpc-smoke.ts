/**
 * gRPC smoke test: connects to the Concordium node and reads balance + next nonce for the
 * accounts listed in .env (CCD_SPONSOR_ADDRESS, CCD_COMPANY_ADDRESS, CCD_AGENT_ADDRESS,
 * CACHET_TREASURY_ADDRESS, CCD_PERSON_ADDRESS). Addresses can also be passed as arguments.
 *
 *   pnpm smoke:grpc
 *   pnpm smoke:grpc <address> [<address> …]
 */
import { createGrpcClient, getAccountSnapshot } from '@cachet/concordium';
import { fail, loadRootEnv, network, optionalPort } from './env';

const ENV_ACCOUNTS = [
  'CCD_SPONSOR_ADDRESS',
  'CCD_COMPANY_ADDRESS',
  'CCD_AGENT_ADDRESS',
  'CACHET_TREASURY_ADDRESS',
  'CCD_PERSON_ADDRESS',
] as const;

async function main(): Promise<void> {
  loadRootEnv();
  const net = network();
  const client = createGrpcClient({ network: net, host: process.env['CCD_GRPC_HOST'], port: optionalPort() });

  const fromArgs = process.argv.slice(2).map((a) => ({ label: 'arg', address: a }));
  const fromEnv = ENV_ACCOUNTS.flatMap((key) => {
    const address = process.env[key]?.trim();
    return address ? [{ label: key, address }] : [];
  });
  const targets = fromArgs.length > 0 ? fromArgs : fromEnv;

  const status = await client.getConsensusStatus();
  console.log(`✓ Connected to ${net}. Last finalized block height: ${status.lastFinalizedBlockHeight}\n`);

  if (targets.length === 0) {
    console.log('No accounts to check. Fill CCD_SPONSOR_ADDRESS etc. in .env, or pass an address.');
    return;
  }

  let failures = 0;
  for (const { label, address } of targets) {
    try {
      const a = await getAccountSnapshot(client, address);
      const tokens = a.tokens.length > 0 ? a.tokens.map((t) => `${t.balance} ${t.id}`).join(', ') : 'none';
      console.log(`✓ ${label}  ${a.address}`);
      console.log(
        `    CCD: ${a.ccd}   next nonce: ${a.nextNonce}${a.allFinal ? '' : ' (pending tx)'}   tokens: ${tokens}`,
      );
    } catch (err) {
      failures++;
      console.log(`✗ ${label}  ${address}\n    ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failures > 0) fail(`${failures} account(s) could not be read`);
}

main().catch(fail);
