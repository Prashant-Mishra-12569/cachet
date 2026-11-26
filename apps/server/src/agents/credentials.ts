import {
  accountPublicKeyHex,
  credentialStatus,
  registerCredentialParameter,
  registryEntrypoint,
  revokeCredentialParameter,
  type CredentialStatus,
  type TxSender,
} from '@cachet/concordium';
import type { ConcordiumGRPCClient } from '@concordium/web-sdk';
import type { KvStore } from '../infra/kv';
import type { AgentRecord } from './repo';

/**
 * Concordium Web3 ID: Cachet's "Authorised AI Caller" credential (CIS-4 registry). Every live AI
 * caller holds one, keyed by its own Concordium public key. Cachet revokes it if the company is
 * suspended, and refuses seals while it is revoked.
 */
export interface CredentialRegistryConfig {
  index: bigint;
  subindex: bigint;
  /** Credential metadata (title, logo, colour) served by the website. */
  metadataUrl: string;
}

export type LiveCredential = CredentialStatus | 'unknown';

export function createCredentialChecker(deps: {
  grpc: Pick<ConcordiumGRPCClient, 'invokeContract' | 'getAccountInfo'>;
  registry: CredentialRegistryConfig;
  cacheMs?: number;
  now?: () => number;
  /** For tests: replace the chain reads. */
  read?: {
    holderOf: (account: string) => Promise<string>;
    status: (holderHex: string) => Promise<CredentialStatus>;
  };
}) {
  const now = deps.now ?? Date.now;
  const holders = new Map<string, string>();
  const cache = new Map<string, { at: number; status: LiveCredential }>();
  const read = deps.read ?? {
    holderOf: (account: string) => accountPublicKeyHex(deps.grpc as ConcordiumGRPCClient, account),
    status: (holder: string) => credentialStatus(deps.grpc as ConcordiumGRPCClient, deps.registry, holder),
  };

  async function holderOf(account: string): Promise<string> {
    const hit = holders.get(account);
    if (hit) return hit;
    const h = await read.holderOf(account);
    holders.set(account, h);
    return h;
  }

  return {
    registry: deps.registry,
    holderOf,
    /** Status of an AI caller's credential; 'unknown' when the chain can't be read right now. */
    async statusOf(account: string, force = false): Promise<LiveCredential> {
      const hit = cache.get(account);
      if (!force && hit && now() - hit.at < (deps.cacheMs ?? 30_000)) return hit.status;
      let status: LiveCredential;
      try {
        status = await read.status(await holderOf(account));
      } catch {
        status = 'unknown'; // never guess
      }
      cache.set(account, { at: now(), status });
      return status;
    },
    /** Forget a cached status (after Cachet changed it). */
    forget(account: string) {
      cache.delete(account);
    },
  };
}

export type CredentialChecker = ReturnType<typeof createCredentialChecker>;

/**
 * Background job: issue a credential to every live AI caller that has none; revoke it when the
 * company is suspended. One change per AI caller at a time (Redis claim), sent through the
 * sponsor's single transaction queue.
 */
export function createCredentialIssuer(deps: {
  checker: CredentialChecker;
  sender: Pick<TxSender, 'updateContract' | 'waitForFinal'>;
  kv: Pick<KvStore, 'claim'>;
  agents: { listActive(): Promise<AgentRecord[]> };
  businessStatus: (businessId: string) => Promise<'active' | 'suspended' | null>;
  log?: Pick<Console, 'log' | 'error'>;
  now?: () => Date;
}) {
  const log = deps.log ?? console;
  const now = deps.now ?? (() => new Date());

  async function change(agent: AgentRecord, action: 'issue' | 'revoke', reason: string) {
    if (!(await deps.kv.claim(`w3id:${action}:${agent.agentAccount}`, 600))) return; // already in progress
    const holder = await deps.checker.holderOf(agent.agentAccount);
    const parameter =
      action === 'issue'
        ? registerCredentialParameter({
            holderIdHex: holder,
            validFrom: now(),
            metadataUrl: deps.checker.registry.metadataUrl,
            auxiliary: `cachet:agent:${agent.badge ?? agent.id}`,
          })
        : revokeCredentialParameter({ holderIdHex: holder, reason });
    const hash = await deps.sender.updateContract({
      contract: deps.checker.registry,
      receiveName: registryEntrypoint(action === 'issue' ? 'registerCredential' : 'revokeCredentialIssuer'),
      parameter,
      energy: 20_000n,
    });
    await deps.sender.waitForFinal(hash);
    deps.checker.forget(agent.agentAccount);
    log.log(`[w3id] ${action === 'issue' ? 'issued' : 'revoked'} credential for ${agent.name}: ${hash}`);
  }

  return {
    async tick() {
      const agents = await deps.agents.listActive();
      for (const agent of agents) {
        try {
          const status = await deps.checker.statusOf(agent.agentAccount, true);
          if (status === 'unknown') continue;
          const company = await deps.businessStatus(agent.businessId);
          if (company === 'suspended' && status === 'active') {
            await change(agent, 'revoke', 'Company suspended in Cachet');
          } else if (company === 'active' && status === 'not_found') {
            await change(agent, 'issue', '');
          }
        } catch (err) {
          log.error(`[w3id] ${agent.name}:`, err instanceof Error ? err.message : err);
        }
      }
    },
  };
}
