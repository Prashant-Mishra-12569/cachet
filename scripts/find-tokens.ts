/**
 * Lists every Protocol-Level Token (PLT) on the Concordium network in .env (default: testnet),
 * with its id and decimals. Use the result to fill PLT_TOKEN_ID and PLT_DECIMALS.
 *
 *   pnpm find-tokens
 */
import { createGrpcClient, listPlts } from '@cachet/concordium';
import { stop, loadRootEnv, network, optionalPort } from './env';

// Matches EURQ, EURR, eEUR and also EUDemo (the token Concordium hands out for testing).
const EURO_HINT = /eur|^eu/i;

async function main(): Promise<void> {
  loadRootEnv();
  const net = network();
  const client = createGrpcClient({ network: net, host: process.env['CCD_GRPC_HOST'], port: optionalPort() });

  console.log(`Listing PLTs on ${net}…\n`);
  const tokens = await listPlts(client);
  if (tokens.length === 0) {
    console.log('No PLTs found.');
    return;
  }

  console.log(
    'allowList = true means an account must be added to the token allow list before it can hold it.\n',
  );
  console.table(
    tokens.map((t) => ({
      id: t.id,
      name: t.name ?? '',
      decimals: t.decimals,
      supply: t.totalSupply,
      paused: t.paused ?? '',
      allowList: t.allowList ?? '',
    })),
  );

  const euro = tokens.filter((t) => EURO_HINT.test(t.id) || EURO_HINT.test(t.name ?? ''));
  console.log(
    euro.length > 0
      ? `Euro candidates: ${euro.map((t) => `${t.id} (${t.decimals} decimals)`).join(', ')}`
      : 'No euro-looking token found. Ask Concordium on Discord which PLT to use.',
  );
}

main().catch(stop);
