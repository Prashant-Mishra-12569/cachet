/**
 * Independent check that a seal is in Cachet's permanent public record, using only public data:
 *   1. the public seal view (GET /v1/seals/:id) gives the seal's hash, its Merkle proof and the anchor tx;
 *   2. we recompute the proof ourselves → Merkle root;
 *   3. we read that transaction STRAIGHT FROM CONCORDIUM and check it stores "CACHET1" || that root.
 *
 *   pnpm anchor:verify <sealId> [apiBaseUrl]
 */
import { TransactionHash } from '@concordium/web-sdk';
import { createGrpcClient, registeredDataOf } from '@cachet/concordium';
import { explorerTxUrl } from '@cachet/shared';
import { parseAnchorPayload, verifyMerkleProof } from '@cachet/shared/seal';
import { fail, stop, loadRootEnv, network, optionalPort, apiBase } from './env';

interface PublicAnchor {
  status: string;
  txHash?: string | null;
  root?: string;
  itemHash?: string;
  proof?: string[];
}

async function main(): Promise<void> {
  loadRootEnv();
  const [sealId, api = apiBase()] = process.argv.slice(2);
  if (!sealId) fail('usage: pnpm anchor:verify <sealId> [apiBaseUrl]');
  const net = network();

  const res = await fetch(`${api}/v1/seals/${sealId}`);
  if (!res.ok) fail(`seal not found (HTTP ${res.status})`);
  const view = (await res.json()) as {
    sealHash: string;
    anchor: PublicAnchor;
    company: { legalName: string };
  };
  const a = view.anchor;
  if (a.status !== 'finalized' || !a.txHash || !a.root || !a.proof) {
    fail(`seal is not anchored yet (anchor status: ${a.status}). Anchors are written every few minutes.`);
  }
  console.log(`Seal ${sealId} (${view.company.legalName})`);

  // 2. Recompute the proof from the seal's hash.
  if (a.itemHash !== view.sealHash) fail('anchor item is not this seal');
  if (!verifyMerkleProof(view.sealHash, a.proof, a.root))
    fail('Merkle proof does NOT lead to the anchored root');
  console.log(
    `✓ Merkle proof (${a.proof.length} steps) leads from the seal's hash to root ${a.root.slice(0, 16)}…`,
  );

  // 3. Read the transaction straight from the chain.
  const grpc = createGrpcClient({ network: net, host: process.env['CCD_GRPC_HOST'], port: optionalPort() });
  const status = await grpc.getBlockItemStatus(TransactionHash.fromHexString(a.txHash));
  if (status.status !== 'finalized') fail(`transaction is ${status.status}, not finalized`);
  const data = registeredDataOf(status.outcome);
  if (!data) fail('transaction is not a RegisterData record');
  const onChainRoot = parseAnchorPayload(data);
  if (onChainRoot !== a.root) fail(`chain stores ${onChainRoot ?? 'no CACHET1 root'}, page claims ${a.root}`);
  const sender = (status.outcome.summary as { sender?: { address?: string } }).sender;
  console.log(`✓ Concordium ${net}: finalized RegisterData stores "CACHET1" || ${onChainRoot.slice(0, 16)}…`);
  if (sender) console.log(`    sent by ${String(sender.address ?? sender)}`);
  console.log(`    ${explorerTxUrl(net, a.txHash)}`);
  console.log("✓ This seal is in Cachet's permanent public record.");
}

main().catch(stop);
