/**
 * Minimal client for the hosted Concordium Agent Registry service.
 * REST: GET /healthz, /v1/check-badge/{id}, /v1/verify-agent-card/{badge}, ...
 * MCP:  POST /mcp (JSON-RPC 2.0, tools/call) for tools without a REST twin, e.g. contract_info.
 */
import type { Network } from '@cachet/shared';

export const DEFAULT_REGISTRY_API = 'https://agent-registry-mcp.concordium.com';

export interface ContractRef {
  index: number;
  subindex: number;
}

export interface RegistryContractInfo {
  network: string;
  network_name: string;
  cis8004_contract: ContractRef;
  cis8004_module_ref: string;
  cis8004_admin: string;
  cis8_contract: ContractRef;
  cis8_module_ref: string;
  supported_standards: string[];
  explorer_base: string;
}

export class RegistryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

export interface RegistryClientOptions {
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  fetch?: typeof fetch;
}

interface McpToolResult {
  content?: { type: string; text?: string }[];
  isError?: boolean;
}

interface JsonRpcResponse {
  result?: McpToolResult;
  error?: { code: number; message: string };
}

/** MCP over streamable HTTP may answer as plain JSON or as an SSE stream; accept both. */
function parseRpcBody(body: string): JsonRpcResponse {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as JsonRpcResponse;
  const data = trimmed
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('');
  return JSON.parse(data) as JsonRpcResponse;
}

export function createRegistryClient(options: RegistryClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? DEFAULT_REGISTRY_API).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 20_000;
  const doFetch = options.fetch ?? fetch;
  let rpcId = 0;

  async function request(path: string, init?: RequestInit): Promise<string> {
    const res = await doFetch(`${baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new RegistryError(`Registry ${path} returned HTTP ${res.status}`, res.status);
    return text;
  }

  async function getJson<T>(path: string): Promise<T> {
    return JSON.parse(await request(path)) as T;
  }

  /** Call an MCP tool and parse its JSON text result. */
  async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const body = await request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    const rpc = parseRpcBody(body);
    if (rpc.error) throw new RegistryError(`MCP ${name}: ${rpc.error.message}`);
    const text = rpc.result?.content?.find((c) => c.type === 'text')?.text;
    if (rpc.result?.isError) throw new RegistryError(`MCP ${name}: ${text ?? 'tool error'}`);
    if (text === undefined) throw new RegistryError(`MCP ${name}: empty result`);
    return JSON.parse(text) as T;
  }

  async function built(name: string, args: Record<string, unknown>): Promise<BuiltTx> {
    const raw = await callTool<RawBuiltTx>(name, args);
    if (
      !raw?.contract_address ||
      typeof raw.receive_name !== 'string' ||
      typeof raw.parameter_hex !== 'string' ||
      !/^[0-9a-f]*$/i.test(raw.parameter_hex)
    ) {
      throw new RegistryError(`MCP ${name}: unexpected payload shape`);
    }
    return {
      contract: raw.contract_address,
      receiveName: raw.receive_name,
      parameterJson: raw.parameter_json,
      parameterHex: raw.parameter_hex.toLowerCase(),
      suggestedEnergy: Number(raw.suggested_energy ?? 30_000),
    };
  }

  return {
    baseUrl,
    health: () => getJson<{ ok: boolean; version: string }>('/healthz'),
    contractInfo: (network: Network) => callTool<RegistryContractInfo>('contract_info', { network }),
    /** Badge (base58 CIS-2 token address) or an owner account. */
    checkBadge: <T = BadgeCheck>(id: string) => getJson<T>(`/v1/check-badge/${encodeURIComponent(id)}`),
    buildRegister: (network: Network, sender: string) => built('build_register', { network, sender }),
    buildSetAgentUri: (
      network: Network,
      tokenId: bigint,
      agentUri: string,
      metadataHashHex: string,
      sender: string,
    ) =>
      built('build_set_agent_uri', {
        network,
        token_id: tokenId.toString(),
        agent_uri: agentUri,
        metadata_hash_hex: metadataHashHex,
        sender,
      }),
    async buildAgentCard(input: BuildAgentCardInput): Promise<{ cardJson: string; metadataHashHex: string }> {
      const r = await callTool<{ agent_card_json?: unknown; metadata_hash_hex?: unknown }>(
        'build_agent_card',
        {
          network: input.network,
          name: input.name,
          description: input.description,
          agent_uri: input.agentUri,
          owner_account: input.ownerAccount,
          token_id: input.tokenId.toString(),
          version: input.version ?? '1.0.0',
          skills: input.skills,
          provider: input.provider ?? null,
          documentation_url: input.documentationUrl ?? null,
        },
      );
      if (typeof r.agent_card_json !== 'string' || typeof r.metadata_hash_hex !== 'string') {
        throw new RegistryError('MCP build_agent_card: unexpected payload shape');
      }
      return { cardJson: r.agent_card_json, metadataHashHex: r.metadata_hash_hex };
    },
    async tokenAddress(contract: ContractRef, tokenId: bigint): Promise<string> {
      const r = await callTool<{ token_address?: unknown }>('token_address', {
        contract_index: contract.index,
        contract_subindex: contract.subindex,
        token_id: tokenId.toString(),
      });
      if (typeof r.token_address !== 'string') throw new RegistryError('MCP token_address: no address');
      return r.token_address;
    },
    callTool,
  };
}

/** A sign-ready contract update from the registry's build_* tools. */
export interface BuiltTx {
  contract: ContractRef;
  receiveName: string;
  /** Parameter in the contract schema's JSON form (what the browser wallet takes). */
  parameterJson: unknown;
  /** The same parameter, wire-encoded. */
  parameterHex: string;
  suggestedEnergy: number;
}

interface RawBuiltTx {
  contract_address?: ContractRef;
  receive_name?: unknown;
  parameter_json?: unknown;
  parameter_hex?: unknown;
  suggested_energy?: unknown;
}

export interface BuildAgentCardInput {
  network: Network;
  name: string;
  description: string;
  agentUri: string;
  ownerAccount: string;
  tokenId: bigint;
  version?: string;
  skills: { id: string; name: string; description: string; tags: string[] }[];
  provider?: { organization: string; url?: string };
  documentationUrl?: string;
}

/** GET /v1/check-badge/{badge} (shape checked live 17–20 Nov 2026). */
export interface BadgeCheck {
  badge_valid: boolean;
  checks?: Record<string, boolean>;
  issues?: { severity: string; field: string; message: string }[];
}

export type RegistryClient = ReturnType<typeof createRegistryClient>;
