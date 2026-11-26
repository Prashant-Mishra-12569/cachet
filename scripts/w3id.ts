/**
 * Cachet's Web3 ID registry: the "Authorised AI Caller" credential (CIS-4) on Concordium.
 *
 *   pnpm w3id deploy                         create Cachet's registry (once); prints its address
 *   pnpm w3id issue                          credential for the AI caller in .env (CCD_AGENT_ADDRESS)
 *   pnpm w3id status [account]               live status on chain
 *   pnpm w3id revoke [account] "reason"      Cachet takes it back
 *   pnpm w3id restore [account] "reason"     undo a revocation
 *
 * Issuer account = the sponsor (CCD_SPONSOR_*); issuer key = Cachet's seal-signing key (SEAL_SIGNING_KEY).
 * Registry address from W3ID_REGISTRY in .env (e.g. <13050,0>) after `deploy`.
 */
import { fileURLToPath } from 'node:url';
import {
  CREDENTIAL_REGISTRY_CONTRACT,
  CREDENTIAL_REGISTRY_MODULE_REF,
  accountPublicKeyHex,
  createGrpcClient,
  createTxSender,
  credentialStatus,
  loadAccountKey,
  parseContractAddress,
  registerCredentialParameter,
  registryEntrypoint,
  registryInitParameter,
  restoreCredentialParameter,
  revokeCredentialParameter,
} from '@cachet/concordium';
import { explorerTxUrl } from '@cachet/shared';
import { loadSealSigningKey, publicJwk } from '@cachet/shared/seal';
import { fail, loadRootEnv, network, optionalPort, stop } from './env';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://getcachet.site';
export const W3ID = {
  issuerMetadataUrl: `${SITE}/w3id/issuer.json`,
  schemaUrl: `${SITE}/w3id/authorised-ai-caller.schema.json`,
  credentialMetadataUrl: `${SITE}/w3id/authorised-ai-caller.json`,
  credentialType: 'AuthorisedAICaller',
};

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) fail(`${name} is empty in .env.`);
  return v;
}

async function main() {
  loadRootEnv();
  const [command, arg1, arg2] = process.argv.slice(2);
  const net = network();
  const grpc = createGrpcClient({ network: net, host: process.env['CCD_GRPC_HOST'], port: optionalPort() });
  const tx = (hash: string) => explorerTxUrl(net, hash);

  async function sender() {
    const key = await loadAccountKey({
      path: need('CCD_SPONSOR_KEY_PATH'),
      expectedAddress: need('CCD_SPONSOR_ADDRESS'),
      network: net,
      forbiddenDir: REPO_ROOT,
    });
    return createTxSender({ client: grpc, address: key.address.address, signer: key.signer });
  }
  const registry = () => parseContractAddress(need('W3ID_REGISTRY'));
  const holder = async (account?: string) => accountPublicKeyHex(grpc, account ?? need('CCD_AGENT_ADDRESS'));

  async function send(label: string, hash: string, s: Awaited<ReturnType<typeof sender>>) {
    console.log(`${label}: sent ${hash}`);
    const outcome = await s.waitForFinal(hash);
    const summary = outcome.summary as unknown as {
      type?: string;
      transactionType?: string;
      failureReason?: unknown;
    };
    if (summary.transactionType === 'failed' || summary.failureReason) {
      fail(`${label} was rejected on chain: ${JSON.stringify(summary.failureReason ?? summary)}`);
    }
    console.log(`✓ ${label} finalized: ${tx(hash)}`);
    return summary as unknown as { contractInitialized?: { address?: { index: bigint; subindex: bigint } } };
  }

  switch (command) {
    case 'deploy': {
      if (process.env['W3ID_REGISTRY'])
        fail(`W3ID_REGISTRY is already set (${process.env['W3ID_REGISTRY']}).`);
      const seal = loadSealSigningKey(need('SEAL_SIGNING_KEY'));
      const issuerKeyHex = Buffer.from(publicJwk(seal).x, 'base64url').toString('hex');
      const s = await sender();
      const parameter = registryInitParameter({
        issuerMetadataUrl: W3ID.issuerMetadataUrl,
        credentialType: W3ID.credentialType,
        schemaUrl: W3ID.schemaUrl,
        issuerAccount: s.address,
        issuerKeyHex,
      });
      const hash = await s.initContract({
        moduleRef: CREDENTIAL_REGISTRY_MODULE_REF,
        contractName: CREDENTIAL_REGISTRY_CONTRACT,
        parameter,
        energy: 30_000n,
      });
      const summary = await send('Registry created', hash, s);
      const address = summary.contractInitialized?.address;
      if (!address)
        fail('Created, but no contract address in the result. Look it up on the explorer link above.');
      console.log(
        `\nAdd this line to .env (and to the Railway server variables):\nW3ID_REGISTRY=<${address.index},${address.subindex}>`,
      );
      console.log(`Issuer key (Cachet's seal key): ${issuerKeyHex}`);
      return;
    }
    case 'issue': {
      const holderId = await holder();
      const before = await credentialStatus(grpc, registry(), holderId);
      if (before !== 'not_found') fail(`This AI caller already has a credential (status: ${before}).`);
      const s = await sender();
      const hash = await s.updateContract({
        contract: registry(),
        receiveName: registryEntrypoint('registerCredential'),
        parameter: registerCredentialParameter({
          holderIdHex: holderId,
          validFrom: new Date(),
          metadataUrl: W3ID.credentialMetadataUrl,
          auxiliary: `cachet:agent:${need('CACHET_AGENT_BADGE')}`,
        }),
        energy: 20_000n,
      });
      await send('Credential issued', hash, s);
      console.log(`Holder (the AI caller's own key): ${holderId}`);
      console.log(`Status now: ${await credentialStatus(grpc, registry(), holderId)}`);
      return;
    }
    case 'status': {
      const holderId = await holder(arg1);
      console.log(`Holder ${holderId}: ${await credentialStatus(grpc, registry(), holderId)}`);
      return;
    }
    case 'revoke':
    case 'restore': {
      const account = arg1 && /^[1-9A-HJ-NP-Za-km-z]{50}$/.test(arg1) ? arg1 : undefined;
      const reason =
        (account ? arg2 : arg1) ?? (command === 'revoke' ? 'Revoked by Cachet' : 'Restored by Cachet');
      const holderId = await holder(account);
      const s = await sender();
      const hash = await s.updateContract({
        contract: registry(),
        receiveName: registryEntrypoint(
          command === 'revoke' ? 'revokeCredentialIssuer' : 'restoreCredential',
        ),
        parameter:
          command === 'revoke'
            ? revokeCredentialParameter({ holderIdHex: holderId, reason })
            : restoreCredentialParameter({ holderIdHex: holderId, reason }),
        energy: 20_000n,
      });
      await send(command === 'revoke' ? 'Credential revoked' : 'Credential restored', hash, s);
      console.log(`Status now: ${await credentialStatus(grpc, registry(), holderId)}`);
      return;
    }
    default:
      fail(
        'Usage: pnpm w3id deploy | issue | status [account] | revoke [account] "reason" | restore [account] "reason"',
      );
  }
}

main().catch(stop);
