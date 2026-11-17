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

  return {
    baseUrl,
    health: () => getJson<{ ok: boolean; version: string }>('/healthz'),
    contractInfo: (network: Network) => callTool<RegistryContractInfo>('contract_info', { network }),
    /** Badge (base58 CIS-2 token address) or an owner account. */
    checkBadge: <T = unknown>(id: string) => getJson<T>(`/v1/check-badge/${encodeURIComponent(id)}`),
    callTool,
  };
}

export type RegistryClient = ReturnType<typeof createRegistryClient>;
