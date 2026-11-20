/**
 * Live testnet check of a SPONSORED token transfer (plan §13.2): the sender pays a PLT amount, and
 * Cachet's sponsor account pays the transaction fee, so the sender needs no CCD.
 *
 *   pnpm pay:smoke [amount=0.01]
 *
 * Sender = the agent test account (holds EUDemo; its key is in .env), recipient = the company account,
 * fee payer = the sponsor. The transaction goes through JSON exactly as it will between our server and
 * the person's wallet. Prints whose CCD paid the fee.
 */
import { fileURLToPath } from 'node:url';
import {
  AccountAddress,
  CborAccountAddress,
  CborMemo,
  TokenAmount,
  TokenId,
  TransactionExpiry,
  createTokenUpdatePayload,
} from '@concordium/web-sdk';
import { Transaction } from '@concordium/web-sdk/transactions';
import { createGrpcClient, loadAccountKey } from '@cachet/concordium';
import { explorerTxUrl } from '@cachet/shared';
import { fail, loadRootEnv, network, optionalPort, stop } from './env';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function need(name: string): string {
  const v = process.env[name];
  if (!v) fail(`${name} must be set in .env`);
  return v;
}

/** JSON for the wallet, as in Concordium's sponsor tutorial: bigint → number when safe, else string. */
const toWire = (v: unknown) =>
  JSON.stringify(v, (_k, x: unknown) =>
    typeof x === 'bigint' ? (x <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(x) : x.toString()) : x,
  );

async function main(): Promise<void> {
  loadRootEnv();
  const net = network();
  const amount = process.argv[2] ?? '0.01';
  if (!/^\d+(\.\d{1,6})?$/.test(amount)) fail('amount must look like 0.01');
  const tokenId = TokenId.fromString(process.env['PLT_TOKEN_ID'] ?? 'EUDemo');
  const grpc = createGrpcClient({ network: net, host: process.env['CCD_GRPC_HOST'], port: optionalPort() });

  const sender = await loadAccountKey({
    path: need('CCD_AGENT_KEY_PATH'),
    expectedAddress: need('CCD_AGENT_ADDRESS'),
    network: net,
    forbiddenDir: REPO_ROOT,
  });
  const sponsor = await loadAccountKey({
    path: need('CCD_SPONSOR_KEY_PATH'),
    expectedAddress: need('CCD_SPONSOR_ADDRESS'),
    network: net,
    forbiddenDir: REPO_ROOT,
  });
  const recipient = AccountAddress.fromBase58(need('CCD_COMPANY_ADDRESS'));

  const ccd = async (a: AccountAddress.Type) => (await grpc.getAccountInfo(a)).accountAmount.microCcdAmount;
  const tokenBalance = async (a: AccountAddress.Type) =>
    (await grpc.getAccountInfo(a)).accountTokens.find((t) => t.id.toString() === tokenId.toString())?.state
      .balance;
  const before = { sender: await ccd(sender.address), sponsor: await ccd(sponsor.address) };
  const bal = await tokenBalance(sender.address);
  console.log(
    `Sender ${AccountAddress.toBase58(sender.address).slice(0, 6)}… holds ${bal ? TokenAmount.toDecimal(bal).toString() : '0'} ${tokenId.toString()}`,
  );

  // 1. Server: build the transfer, fixed amount + recipient + memo, sponsored by Cachet.
  const payload = createTokenUpdatePayload(tokenId, {
    transfer: {
      amount: TokenAmount.fromDecimal(amount, 6),
      recipient: CborAccountAddress.fromAccountAddress(recipient),
      memo: CborMemo.fromString('cachet:pay-smoke'),
    },
  });
  const nonce = await grpc.getNextAccountNonce(sender.address);
  const signable = Transaction.tokenUpdate(payload)
    .addMetadata({ sender: sender.address, nonce: nonce.nonce, expiry: TransactionExpiry.futureMinutes(5) })
    .addSponsor(sponsor.address)
    .build();
  const sponsored = await Transaction.sponsor(signable, sponsor.signer);
  const wire = toWire(Transaction.toJSON(sponsored));
  console.log(`✓ sponsored by Cachet (${wire.length} bytes of JSON to the wallet)`);

  // 2. Wallet: parse what the server sent, check it, co-sign, submit.
  const received = Transaction.signableFromJSON(JSON.parse(wire));
  if (received.version !== 1 || !received.signatures.sponsor) fail('not a sponsored transaction');
  const final = await Transaction.signAndFinalize(received, sender.signer);
  const hash = await grpc.sendTransaction(final);
  console.log(`✓ submitted ${hash.toString()} — waiting for finalization…`);
  const outcome = await grpc.waitForTransactionFinalization(hash);
  const summary = outcome.summary as unknown as Record<string, unknown>;
  console.log(
    `  outcome: ${JSON.stringify(summary, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x)).slice(0, 900)}`,
  );

  const after = { sender: await ccd(sender.address), sponsor: await ccd(sponsor.address) };
  const senderPaid = before.sender - after.sender;
  const sponsorPaid = before.sponsor - after.sponsor;
  console.log(`\nCCD paid by sender:  ${senderPaid} µCCD`);
  console.log(`CCD paid by sponsor: ${sponsorPaid} µCCD`);
  console.log(`Explorer: ${explorerTxUrl(net, hash.toString())}`);
  if (senderPaid !== 0n) fail('the SENDER paid a fee: sponsoring did not work');
  console.log('✓ the sender paid no CCD: Cachet sponsored the fee');
}

main().catch(stop);
