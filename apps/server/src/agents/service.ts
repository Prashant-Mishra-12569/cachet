import { NETWORK_CONFIG, type Network } from '@cachet/shared';
import type { AgentPurpose } from '@cachet/db';
import type { BusinessRecord, BusinessRepo } from '../business/repo';
import { CardHostError, type CardHost } from './card-host';
import { sha256Hex, skillsFor, withCachetExtension } from './card';
import type { RegistryGateway, WalletTx } from './registry-gateway';
import { DuplicateError, type AgentRecord, type AgentRepo } from './repo';

export type AgentErrorCode =
  | 'business_not_verified'
  | 'agent_not_found'
  | 'agent_wrong_state'
  | 'number_in_use'
  | 'too_many_agents'
  | 'tx_already_used'
  | 'tx_mismatch'
  | 'card_host_unavailable'
  | 'card_not_served';

export class AgentError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    readonly detail?: string,
  ) {
    super(code);
    this.name = 'AgentError';
  }
}

export interface NewAgent {
  name: string;
  description: string;
  purposes: AgentPurpose[];
  language: string;
  callingNumbers: string[];
  agentAccount: string;
}

export interface AgentServiceDeps {
  agents: AgentRepo;
  businesses: BusinessRepo;
  gateway: RegistryGateway;
  /** null when no host is configured (e.g. GIST_TOKEN missing). */
  cardHost: CardHost | null;
  network: Network;
  maxAgentsPerBusiness?: number;
  /** How long to wait for the published card to be publicly served with the right bytes. */
  servedTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const REGISTER = 'CIS-8004.register';
const SET_URI = 'CIS-8004.setAgentURI';

export function createAgentService(deps: AgentServiceDeps) {
  const maxAgents = deps.maxAgentsPerBusiness ?? 5;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const caip2 = NETWORK_CONFIG[deps.network].caip2;

  /** Only a business that proved its company may manage AI callers. */
  async function businessOf(account: string): Promise<BusinessRecord> {
    const business = await deps.businesses.findByAccount(account);
    if (!business || business.status !== 'active') throw new AgentError('business_not_verified');
    return business;
  }

  async function agentOf(account: string, agentId: string) {
    const business = await businessOf(account);
    const agent = await deps.agents.findForBusiness(business.id, agentId);
    if (!agent) throw new AgentError('agent_not_found');
    return { business, agent };
  }

  function expect(agent: AgentRecord, status: AgentRecord['status']) {
    if (agent.status !== status)
      throw new AgentError('agent_wrong_state', `is ${agent.status}, expected ${status}`);
  }

  /** Apply a state change; a lost race or a reused transaction becomes a clear error. */
  async function transition(agent: AgentRecord, patch: Parameters<AgentRepo['transition']>[2]) {
    try {
      const next = await deps.agents.transition(agent.id, agent.status, patch);
      if (!next) throw new AgentError('agent_wrong_state', 'changed by another request');
      return next;
    } catch (err) {
      if (err instanceof DuplicateError) throw new AgentError('tx_already_used', err.column);
      throw err;
    }
  }

  return {
    async list(account: string) {
      const business = await businessOf(account);
      return deps.agents.listByBusiness(business.id);
    },

    async create(account: string, input: NewAgent) {
      const business = await businessOf(account);
      const existing = await deps.agents.listByBusiness(business.id);
      if (existing.filter((a) => a.status !== 'revoked').length >= maxAgents) {
        throw new AgentError('too_many_agents');
      }
      const used = await deps.agents.numbersInUse(input.callingNumbers);
      if (used.length > 0) throw new AgentError('number_in_use', used.join(', '));
      return deps.agents.create({ ...input, businessId: business.id });
    },

    /** Step 3a: the register transaction for the company's wallet. Mints the agent; sets agentWallet = company. */
    async prepareRegister(account: string, agentId: string): Promise<WalletTx> {
      const { agent } = await agentOf(account, agentId);
      expect(agent, 'draft');
      return deps.gateway.toWalletTx(await deps.gateway.buildRegister(account), account);
    },

    /** Step 3b: check the submitted register transaction on chain and record the new token id. */
    async confirmRegister(account: string, agentId: string, txHash: string) {
      const { agent } = await agentOf(account, agentId);
      expect(agent, 'draft');
      const tx = await deps.gateway.confirm(txHash, account, REGISTER);
      const registered = tx.events.filter((e) => e.type === 'Registered' && e.owner === account);
      const first = registered[0];
      if (registered.length !== 1 || !first || first.type !== 'Registered') {
        throw new AgentError(
          'tx_mismatch',
          `expected 1 Registered event for ${account}, got ${registered.length}`,
        );
      }
      const tokenId = first.tokenId;
      const walletSet = tx.events.find((e) => e.type === 'AgentWalletSet' && e.tokenId === tokenId);
      const badge = await deps.gateway.tokenAddress(tokenId);
      return transition(agent, {
        status: 'registered',
        tokenId,
        badge,
        registerTx: tx.txHash,
        agentWallet: walletSet?.type === 'AgentWalletSet' ? walletSet.wallet : null,
      });
    },

    /**
     * Step 4a: build the Agent Card (registry badge + Cachet extension), publish it, make sure the
     * public URL serves exactly those bytes, then return the setAgentURI transaction.
     */
    async prepareCard(account: string, agentId: string) {
      const { business, agent } = await agentOf(account, agentId);
      expect(agent, 'registered');
      if (agent.tokenId === null) throw new AgentError('agent_wrong_state', 'no token id');
      if (!deps.cardHost) throw new AgentError('card_host_unavailable', 'no card host configured');

      let slot;
      try {
        slot = await deps.cardHost.reserve(`${business.legalName} · ${agent.name}`);
      } catch (err) {
        throw new AgentError(
          'card_host_unavailable',
          err instanceof CardHostError ? err.message : String(err),
        );
      }

      const registryCard = await deps.gateway.buildCard({
        name: agent.name,
        description: agent.description,
        agentUri: slot.url,
        ownerAccount: account,
        tokenId: agent.tokenId,
        skills: skillsFor(agent.purposes),
        provider: { organization: business.legalName },
      });
      const { cardJson, metadataHash } = withCachetExtension(registryCard, {
        version: 1,
        company: {
          legalName: business.legalName,
          legalCountry: business.legalCountry,
          issuer: business.issuer,
          proofTx: business.proofTx,
        },
        purposes: agent.purposes,
        language: agent.language,
        callingNumbers: agent.callingNumbers,
        agentAccount: `${caip2}:${agent.agentAccount}`,
        neverCalls: business.neverCalls,
      });

      try {
        await slot.write(cardJson);
      } catch (err) {
        throw new AgentError('card_host_unavailable', err instanceof Error ? err.message : String(err));
      }

      // Hash what the public URL ACTUALLY serves, not what we think we wrote.
      const deadline = Date.now() + (deps.servedTimeoutMs ?? 60_000);
      let lastSeen: string;
      for (;;) {
        try {
          lastSeen = sha256Hex(await deps.cardHost.fetchServed(slot.url));
          if (lastSeen === metadataHash) break;
        } catch (err) {
          lastSeen = err instanceof Error ? err.message : String(err);
        }
        if (Date.now() > deadline)
          throw new AgentError('card_not_served', `served ${lastSeen}, want ${metadataHash}`);
        await sleep(2_000);
      }

      const updated = await transition(agent, { agentUri: slot.url, metadataHash, cardJson });
      const walletTx = await deps.gateway.toWalletTx(
        await deps.gateway.buildSetAgentUri(agent.tokenId, slot.url, metadataHash, account),
        account,
      );
      return { agent: updated, walletTx };
    },

    /** Step 4b: check the setAgentURI transaction pinned exactly our URL + hash; the agent is now active. */
    async confirmCard(account: string, agentId: string, txHash: string) {
      const { agent } = await agentOf(account, agentId);
      expect(agent, 'registered');
      if (agent.tokenId === null || !agent.agentUri || !agent.metadataHash) {
        throw new AgentError('agent_wrong_state', 'card not prepared');
      }
      const tx = await deps.gateway.confirm(txHash, account, SET_URI);
      const pinned = tx.events.find(
        (e) =>
          e.type === 'URIUpdated' &&
          e.tokenId === agent.tokenId &&
          e.agentUri === agent.agentUri &&
          e.metadataHash === agent.metadataHash,
      );
      if (!pinned) throw new AgentError('tx_mismatch', 'no URIUpdated event with our token, URL and hash');
      return transition(agent, { status: 'active', cardTx: tx.txHash });
    },

    /** Live "Verified by Concordium" badge check (Concordium's own checker). */
    async badge(account: string, agentId: string) {
      const { agent } = await agentOf(account, agentId);
      if (!agent.badge) throw new AgentError('agent_wrong_state', 'not registered');
      return deps.gateway.checkBadge(agent.badge);
    },
  };
}

export type AgentService = ReturnType<typeof createAgentService>;
