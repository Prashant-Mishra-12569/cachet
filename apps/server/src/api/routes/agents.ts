import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { normalizeAccountAddress } from '@cachet/concordium';
import { AGENT_PURPOSES } from '@cachet/db';
import { explorerTxUrl, type Network } from '@cachet/shared';
import type { AuthService } from '../../auth/service';
import { AgentError, type AgentService } from '../../agents/service';
import { GatewayError } from '../../agents/registry-gateway';
import type { AgentRecord } from '../../agents/repo';
import type { KvStore } from '../../infra/kv';
import { apiError } from '../errors';
import { rateLimit, requireSameOrigin, requireSession, type SessionEnv } from '../middleware';

export interface AgentRouteDeps {
  auth: AuthService;
  kv: KvStore;
  agents: AgentService;
  network: Network;
  registryUrl: string;
  webOrigin: string;
  secureCookies: boolean;
  trustProxy: boolean;
}

const E164 = /^\+[1-9]\d{6,14}$/;

const NewAgentBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  purposes: z.array(z.enum(AGENT_PURPOSES)).min(1).max(AGENT_PURPOSES.length),
  language: z
    .string()
    .regex(/^[a-z]{2}$/)
    .default('en'),
  callingNumbers: z.array(z.string().trim().regex(E164, 'must be E.164, e.g. +31201234567')).min(1).max(10),
  agentAccount: z.string().trim().min(1).max(100),
});

const TxBody = z.object({ txHash: z.string().regex(/^[0-9a-fA-F]{64}$/) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function agentView(a: AgentRecord, network: Network, registryUrl: string) {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    purposes: a.purposes,
    language: a.language,
    callingNumbers: a.callingNumbers,
    agentAccount: a.agentAccount,
    status: a.status,
    tokenId: a.tokenId?.toString() ?? null,
    badge: a.badge,
    badgeCheckUrl: a.badge ? `${registryUrl}/v1/check-badge/${a.badge}` : null,
    agentWallet: a.agentWallet,
    agentUri: a.agentUri,
    metadataHash: a.metadataHash,
    registerTxUrl: a.registerTx ? explorerTxUrl(network, a.registerTx) : null,
    cardTxUrl: a.cardTx ? explorerTxUrl(network, a.cardTx) : null,
    /** Numbers waiting for the company's on-chain approval (not in force yet). */
    pendingCallingNumbers: a.pendingCard?.callingNumbers ?? null,
  };
}

const NumbersBody = z.object({
  callingNumbers: z.array(z.string().trim().regex(E164, 'must be E.164, e.g. +31201234567')).min(1).max(10),
});

export function agentRoutes(deps: AgentRouteDeps) {
  const app = new Hono<SessionEnv>();
  app.use('*', requireSameOrigin(deps.webOrigin));
  app.use('*', requireSession(deps.auth, deps.secureCookies));

  const view = (a: AgentRecord) => agentView(a, deps.network, deps.registryUrl);
  const perAccount = (name: string, limit: number) =>
    rateLimit({ kv: deps.kv, name, limit, windowSeconds: 600, trustProxy: deps.trustProxy, byAccount: true });

  /** Known failures → plain-English API errors. Everything else is a real bug (500). */
  async function handle(c: Context<SessionEnv>, fn: () => Promise<Response>) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AgentError || err instanceof GatewayError) {
        const log =
          err.code === 'registry_unavailable' || err.code === 'registry_mismatch'
            ? console.error
            : console.warn;
        log(`[agents] ${err.code} for ${c.var.account}: ${err.detail ?? ''}`);
        return apiError(c, err.code);
      }
      throw err;
    }
  }

  const idOf = (id: string) => {
    if (!UUID.test(id)) throw new AgentError('agent_not_found');
    return id;
  };

  app.get('/', (c) =>
    handle(c, async () => {
      c.header('Cache-Control', 'no-store');
      return c.json({ agents: (await deps.agents.list(c.var.account)).map(view) });
    }),
  );

  app.post('/', perAccount('agent-create', 20), (c) =>
    handle(c, async () => {
      const body = NewAgentBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return apiError(c, 'invalid_request');
      const agentAccount = normalizeAccountAddress(body.data.agentAccount);
      if (!agentAccount) return apiError(c, 'invalid_account');
      const numbers = [...new Set(body.data.callingNumbers)];
      const agent = await deps.agents.create(c.var.account, {
        ...body.data,
        callingNumbers: numbers,
        agentAccount,
      });
      return c.json({ agent: view(agent) }, 201);
    }),
  );

  app.post('/:id/register/prepare', perAccount('agent-tx', 30), (c) =>
    handle(c, async () =>
      c.json({ walletTx: await deps.agents.prepareRegister(c.var.account, idOf(c.req.param('id'))) }),
    ),
  );

  app.post('/:id/register/confirm', (c) =>
    handle(c, async () => {
      const body = TxBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return apiError(c, 'invalid_request');
      const agent = await deps.agents.confirmRegister(
        c.var.account,
        idOf(c.req.param('id')),
        body.data.txHash.toLowerCase(),
      );
      return c.json({ agent: view(agent) });
    }),
  );

  // Publishing creates a new public card each time: keep it tight.
  app.post('/:id/card/prepare', perAccount('agent-card', 5), (c) =>
    handle(c, async () => {
      const { agent, walletTx } = await deps.agents.prepareCard(c.var.account, idOf(c.req.param('id')));
      return c.json({ agent: view(agent), walletTx });
    }),
  );

  app.post('/:id/card/confirm', (c) =>
    handle(c, async () => {
      const body = TxBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return apiError(c, 'invalid_request');
      const agent = await deps.agents.confirmCard(
        c.var.account,
        idOf(c.req.param('id')),
        body.data.txHash.toLowerCase(),
      );
      return c.json({ agent: view(agent) });
    }),
  );

  // Change an active AI caller's calling numbers: publish + stage a new card, then the company pins it.
  app.post('/:id/numbers/prepare', perAccount('agent-card', 5), (c) =>
    handle(c, async () => {
      const body = NumbersBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return apiError(c, 'invalid_request');
      const { agent, walletTx } = await deps.agents.prepareNumbersUpdate(
        c.var.account,
        idOf(c.req.param('id')),
        body.data.callingNumbers,
      );
      return c.json({ agent: view(agent), walletTx });
    }),
  );

  app.post('/:id/numbers/confirm', (c) =>
    handle(c, async () => {
      const body = TxBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return apiError(c, 'invalid_request');
      const agent = await deps.agents.confirmNumbersUpdate(
        c.var.account,
        idOf(c.req.param('id')),
        body.data.txHash.toLowerCase(),
      );
      return c.json({ agent: view(agent) });
    }),
  );

  app.get('/:id/badge', perAccount('agent-badge', 60), (c) =>
    handle(c, async () => {
      c.header('Cache-Control', 'no-store');
      return c.json({ badge: await deps.agents.badge(c.var.account, idOf(c.req.param('id'))) });
    }),
  );

  return app;
}
