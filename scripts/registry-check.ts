/**
 * Checks the hosted Agent Registry service: liveness, testnet contract addresses,
 * and a badge check on one real registered testnet agent.
 *
 *   pnpm registry:check
 */
import { createRegistryClient } from '@cachet/concordium';
import { fail, loadRootEnv, network } from './env';

interface ListedAgent {
  token_id: number;
  owner_account: string;
  status: string;
}

/** Shape of GET /v1/check-badge/{badge} (checked live 17 Nov 2026). */
interface BadgeCheck {
  badge_valid: boolean;
  checks?: Record<string, boolean>;
  issues?: { severity: string; field: string; message: string }[];
}

async function main(): Promise<void> {
  loadRootEnv();
  const net = network();
  const registry = createRegistryClient({ baseUrl: process.env['AGENT_REGISTRY_API'] });

  const health = await registry.health();
  console.log(`✓ ${registry.baseUrl}/healthz → ok=${health.ok} version=${health.version}`);

  const info = await registry.contractInfo(net);
  const cis8004 = `<${info.cis8004_contract.index},${info.cis8004_contract.subindex}>`;
  const cis8 = `<${info.cis8_contract.index},${info.cis8_contract.subindex}>`;
  console.log(`✓ contract_info (${info.network_name})`);
  console.log(`    CIS-8004 Agent Registry: ${cis8004}`);
  console.log(`    CIS-8 key registry:      ${cis8}`);

  const expected = process.env['CIS8004_CONTRACT']?.trim();
  if (expected && expected !== cis8004) {
    fail(`CIS8004_CONTRACT in .env is ${expected}, but the registry says ${cis8004}`);
  }

  // Badge check on a real, active agent, so we know check-badge works end to end.
  const listed = await registry.callTool<{ total: number; agents: ListedAgent[] }>('list_agents', {
    limit: 1,
    status: 'Active',
    network: net,
  });
  console.log(`✓ list_agents: ${listed.total} agents registered on ${net}`);
  const first = listed.agents[0];
  if (!first) {
    console.log('  (no active agents found to badge-check)');
    return;
  }
  const { token_address: badge } = await registry.callTool<{ token_address: string }>('token_address', {
    contract_index: info.cis8004_contract.index,
    contract_subindex: info.cis8004_contract.subindex,
    token_id: first.token_id,
  });
  const check = await registry.checkBadge<BadgeCheck>(badge);
  console.log(`✓ check-badge works (sample agent #${first.token_id}, badge ${badge}, not ours)`);
  console.log(`    badge_valid=${check.badge_valid}`);
  for (const [name, ok] of Object.entries(check.checks ?? {})) console.log(`    ${ok ? '✓' : '✗'} ${name}`);
  for (const issue of check.issues ?? []) console.log(`    issue: ${issue.field}: ${issue.message}`);
}

main().catch(fail);
