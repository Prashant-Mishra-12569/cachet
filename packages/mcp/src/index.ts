/**
 * Run the Cachet MCP server over stdio (how desktop MCP clients start local tools).
 *
 * Settings (environment, or the repo's .env):
 * Receptionist mode (an AI that ANSWERS calls): set nothing below except CACHET_API_URL if needed; the
 * server then only verifies incoming callers (cachet_verify_incoming_call) and checks companies and seals.
 *
 * AI caller mode (an AI that MAKES calls):
 *   CACHET_AGENT_BADGE     your AI caller's Verified-by-Concordium badge
 *   CCD_AGENT_ADDRESS      the AI's own Concordium account
 *   CCD_AGENT_KEY_PATH     its wallet export (stays on this machine; Cachet never sees it)
 *   CACHET_CALLER_ID       default calling number (registered for the AI caller)   [or VOICE_CALLER_ID]
 *   CACHET_API_URL         default https://api.getcachet.site
 *   CCD_NETWORK            default testnet
 *   CACHET_MAX_PAYMENT     most it may pay per x402 payment, default 0.05 (a seal costs 0.01)
 *
 * stdout belongs to the MCP protocol: everything human goes to stderr.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadAccountKey } from '@cachet/concordium';
import { createCachetClient, createPayingFetch } from '@cachet/sdk';
import { NETWORK_CONFIG, isNetwork } from '@cachet/shared';
import { createCachetMcpServer } from './server';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ROOT_ENV = new URL('../../../.env', import.meta.url);

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set (see the top of packages/mcp/src/index.ts).`);
  return v;
}

async function main() {
  // Values passed by the MCP client win; the repo's .env only fills the gaps.
  if (existsSync(ROOT_ENV)) process.loadEnvFile(fileURLToPath(ROOT_ENV));
  const net = process.env['CCD_NETWORK'] ?? 'testnet';
  if (!isNetwork(net)) throw new Error(`CCD_NETWORK must be testnet or mainnet, not ${net}`);

  const apiBase = process.env['CACHET_API_URL']?.trim() || 'https://api.getcachet.site';
  const token = process.env['PLT_TOKEN_ID'] ?? 'EUDemo';
  // No AI caller key = receptionist mode: verify incoming callers and check companies, but never seal.
  const keyPath = process.env['CCD_AGENT_KEY_PATH']?.trim();
  let cachet: ReturnType<typeof createCachetClient> | undefined;
  let who = 'receptionist mode (verifies callers, does not seal)';
  if (keyPath) {
    const key = await loadAccountKey({
      path: keyPath,
      expectedAddress: need('CCD_AGENT_ADDRESS'),
      network: net,
      forbiddenDir: REPO_ROOT,
    });
    const payingFetch = createPayingFetch({
      network: NETWORK_CONFIG[net].caip2,
      account: key.address,
      signer: key.signer,
      token,
      decimals: Number(process.env['PLT_DECIMALS'] ?? '6'),
      maxPerPayment: process.env['CACHET_MAX_PAYMENT'] ?? '0.05',
    });
    cachet = createCachetClient({
      baseUrl: apiBase,
      badge: need('CACHET_AGENT_BADGE'),
      account: key.address.address,
      signer: key.signer,
      fetch: payingFetch,
    });
    who = `AI caller ${key.address.address.slice(0, 8)}…`;
  }

  const server = createCachetMcpServer({
    cachet,
    apiBase,
    callerId: process.env['CACHET_CALLER_ID']?.trim() || process.env['VOICE_CALLER_ID']?.trim(),
    token,
    ...(process.env['AGENT_REGISTRY_API']?.trim()
      ? { registryBase: process.env['AGENT_REGISTRY_API'].trim() }
      : {}),
  });
  await server.connect(new StdioServerTransport());
  console.error(`[cachet-mcp] ready on stdio · API ${apiBase} · ${who}`);
}

main().catch((err: unknown) => {
  console.error(`[cachet-mcp] could not start: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
