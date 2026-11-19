import {
  confirmContractUpdate,
  encodeParameter,
  loadContractSchema,
  readAgentOnChain,
  simulateUpdate,
  TxCheckError,
  type BadgeCheck,
  type BuildAgentCardInput,
  type BuiltTx,
  type ConfirmedUpdate,
  type ContractRef,
  type ContractSchema,
  type OnChainAgent,
  type RegistryClient,
} from '@cachet/concordium';
import type { ConcordiumGRPCClient } from '@concordium/web-sdk';
import type { Network } from '@cachet/shared';

/** What the browser wallet needs to send a contract update (sendTransaction, type Update). */
export interface WalletTx {
  contract: ContractRef;
  receiveName: string;
  /** Parameter in schema-JSON form; the wallet encodes it with `schemaBase64`. */
  parameterJson: unknown;
  schemaBase64: string;
  maxEnergy: number;
  /** For display/debugging: the exact bytes the wallet will produce. */
  parameterHex: string;
}

export type GatewayErrorCode =
  | 'registry_unavailable'
  | 'registry_mismatch'
  | 'registry_rejected'
  | 'tx_not_found'
  | 'tx_failed'
  | 'tx_mismatch';

export class GatewayError extends Error {
  constructor(
    readonly code: GatewayErrorCode,
    readonly detail: string,
  ) {
    super(code);
    this.name = 'GatewayError';
  }
}

export interface RegistryGateway {
  buildRegister(sender: string): Promise<BuiltTx>;
  buildSetAgentUri(tokenId: bigint, agentUri: string, metadataHash: string, sender: string): Promise<BuiltTx>;
  buildCard(input: Omit<BuildAgentCardInput, 'network'>): Promise<string>;
  tokenAddress(tokenId: bigint): Promise<string>;
  /** Check the builder's bytes against our own encoding, simulate as `invoker`, size the energy. */
  toWalletTx(built: BuiltTx, invoker: string): Promise<WalletTx>;
  confirm(txHash: string, sender: string, receiveName: string): Promise<ConfirmedUpdate>;
  checkBadge(badge: string): Promise<BadgeCheck>;
  /** The agent's live record on the registry contract (null if it does not exist). */
  readAgent(tokenId: bigint): Promise<OnChainAgent | null>;
}

export function createRegistryGateway(deps: {
  registry: RegistryClient;
  grpc: ConcordiumGRPCClient;
  network: Network;
}): RegistryGateway {
  let contractPromise: Promise<{ ref: ContractRef; schema: ContractSchema }> | undefined;

  /** Registry contract + its embedded schema, loaded once from chain. */
  function contract() {
    contractPromise ??= (async () => {
      const info = await deps.registry.contractInfo(deps.network);
      const schema = await loadContractSchema(deps.grpc, info.cis8004_module_ref);
      return { ref: info.cis8004_contract, schema };
    })().catch((err: unknown) => {
      contractPromise = undefined; // retry next time
      throw err;
    });
    return contractPromise;
  }

  /** Wrap registry/network failures (not our own checks) as "registry unavailable". */
  async function upstream<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GatewayError) throw err;
      throw new GatewayError(
        'registry_unavailable',
        `${what}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    buildRegister: (sender) =>
      upstream('build_register', () => deps.registry.buildRegister(deps.network, sender)),
    buildSetAgentUri: (tokenId, agentUri, hash, sender) =>
      upstream('build_set_agent_uri', () =>
        deps.registry.buildSetAgentUri(deps.network, tokenId, agentUri, hash, sender),
      ),
    buildCard: (input) =>
      upstream(
        'build_agent_card',
        async () => (await deps.registry.buildAgentCard({ ...input, network: deps.network })).cardJson,
      ),
    tokenAddress: (tokenId) =>
      upstream('token_address', async () => deps.registry.tokenAddress((await contract()).ref, tokenId)),

    async toWalletTx(built, invoker) {
      const { ref, schema } = await upstream('contract_info', contract);
      if (built.contract.index !== ref.index || built.contract.subindex !== ref.subindex) {
        throw new GatewayError(
          'registry_mismatch',
          `builder targets <${built.contract.index},${built.contract.subindex}>`,
        );
      }
      const [contractName, entrypoint] = built.receiveName.split('.');
      if (contractName !== 'CIS-8004' || !entrypoint) {
        throw new GatewayError('registry_mismatch', `unexpected receive name ${built.receiveName}`);
      }
      // The wallet will encode parameterJson with the schema. It must give exactly the builder's bytes.
      let ours: string;
      try {
        ours = encodeParameter(schema, contractName, entrypoint, built.parameterJson);
      } catch (err) {
        throw new GatewayError('registry_mismatch', `cannot encode parameter: ${String(err)}`);
      }
      if (ours !== built.parameterHex) {
        throw new GatewayError(
          'registry_mismatch',
          `encoding differs: ours ${ours} vs builder ${built.parameterHex}`,
        );
      }
      const sim = await upstream('invoke', () =>
        simulateUpdate(deps.grpc, {
          invoker,
          contract: ref,
          receiveName: built.receiveName,
          parameterHex: ours,
        }),
      );
      if (!sim.ok) throw new GatewayError('registry_rejected', sim.reason);
      const maxEnergy = Math.max(built.suggestedEnergy, Math.ceil(Number(sim.usedEnergy) * 1.5) + 1_000);
      return {
        contract: ref,
        receiveName: built.receiveName,
        parameterJson: built.parameterJson,
        schemaBase64: schema.base64,
        maxEnergy,
        parameterHex: ours,
      };
    },

    async confirm(txHash, sender, receiveName) {
      const { ref } = await upstream('contract_info', contract);
      try {
        return await confirmContractUpdate(deps.grpc, { txHash, sender, contract: ref, receiveName });
      } catch (err) {
        if (err instanceof TxCheckError) {
          if (err.code === 'not_found' || err.code === 'timeout')
            throw new GatewayError('tx_not_found', err.message);
          if (err.code === 'failed') throw new GatewayError('tx_failed', err.message);
          throw new GatewayError('tx_mismatch', err.message);
        }
        throw new GatewayError('registry_unavailable', err instanceof Error ? err.message : String(err));
      }
    },

    checkBadge: (badge) => upstream('check_badge', () => deps.registry.checkBadge(badge)),

    readAgent: (tokenId) =>
      upstream('agentOf', async () => {
        const { ref, schema } = await contract();
        return readAgentOnChain(deps.grpc, { contract: ref, schema, tokenId });
      }),
  };
}
