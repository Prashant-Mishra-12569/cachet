import { describe, expect, it } from 'vitest';
import type { CredentialStatus } from '@cachet/concordium';
import { errorCode, setupSealing } from '../api/seal-test-setup';
import { createCredentialChecker, createCredentialIssuer } from './credentials';
import type { AgentRecord } from './repo';

const REGISTRY = { index: 13167n, subindex: 0n, metadataUrl: 'https://getcachet.site/w3id/x.json' };

function checker(statuses: Record<string, CredentialStatus | Error>, now = { t: 0 }) {
  const reads: string[] = [];
  const c = createCredentialChecker({
    grpc: {} as never,
    registry: REGISTRY,
    now: () => now.t,
    read: {
      // A real-format holder key (32 bytes of hex) per account, so encoding works like on chain.
      holderOf: async (account) => Buffer.from(account).toString('hex').padEnd(64, '0'),
      status: async (holder) => {
        reads.push(holder);
        const account = Buffer.from(holder.replace(/(00)+$/, ''), 'hex').toString();
        const s = statuses[account] ?? 'not_found';
        if (s instanceof Error) throw s;
        return s;
      },
    },
  });
  return { c, reads, now };
}

describe('credential checker', () => {
  it('reads once, then serves from cache for 30 s; force reads again', async () => {
    const { c, reads, now } = checker({ A: 'active' });
    expect(await c.statusOf('A')).toBe('active');
    expect(await c.statusOf('A')).toBe('active');
    expect(reads).toHaveLength(1);
    now.t += 30_001;
    await c.statusOf('A');
    await c.statusOf('A', true);
    expect(reads).toHaveLength(3);
  });

  it('chain unreachable → "unknown" (never guesses active or revoked)', async () => {
    const { c } = checker({ A: new Error('UNAVAILABLE') });
    expect(await c.statusOf('A')).toBe('unknown');
  });
});

const agent = (id: string, businessId = 'biz'): AgentRecord =>
  ({ id, name: `Agent ${id}`, agentAccount: id, businessId, badge: `badge-${id}` }) as unknown as AgentRecord;

function issuer(
  statuses: Record<string, CredentialStatus>,
  companies: Record<string, 'active' | 'suspended'>,
) {
  const { c } = checker(statuses);
  const sent: string[] = [];
  const claimed = new Set<string>();
  const job = createCredentialIssuer({
    checker: c,
    sender: {
      updateContract: async ({ receiveName }) => {
        sent.push(String(receiveName.value));
        return `tx${sent.length}`;
      },
      waitForFinal: async () => ({}) as never,
    },
    kv: {
      claim: async (key) => {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
    },
    agents: { listActive: async () => [agent('A', 'bizA'), agent('B', 'bizB'), agent('C', 'bizC')] },
    businessStatus: async (id) => companies[id] ?? null,
    log: { log: () => undefined, error: () => undefined },
  });
  return { job, sent };
}

describe('credential issuer (background job)', () => {
  it('issues to live AI callers without one, revokes for suspended companies, leaves the rest', async () => {
    const { job, sent } = issuer(
      { A: 'not_found', B: 'active', C: 'active' },
      { bizA: 'active', bizB: 'suspended', bizC: 'active' },
    );
    await job.tick();
    expect(sent).toEqual([
      'credential_registry.registerCredential',
      'credential_registry.revokeCredentialIssuer',
    ]);
  });

  it('never sends the same change twice while one is in progress', async () => {
    const { job, sent } = issuer({ A: 'not_found' }, { bizA: 'active' });
    await job.tick();
    await job.tick(); // status still "not_found" in this fake, but the claim holds
    expect(sent).toEqual(['credential_registry.registerCredential']);
  });
});

describe('seals and the credential', () => {
  it('a REVOKED credential stops seals (and spends no credit)', async () => {
    const ctx = await setupSealing({
      credentials: { statusOf: async () => 'revoked', registry: { index: 13167n, subindex: 0n } },
    });
    const res = await ctx.seal();
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('agent_credential_revoked');
    expect(await ctx.sealRepo.creditBalance(ctx.agentId)).toBe(10);
  });

  it('active, or not issued yet, or unknown: sealing works, and the public view shows the status', async () => {
    for (const status of ['active', 'not_found', 'unknown']) {
      const ctx = await setupSealing({
        credentials: { statusOf: async () => status, registry: { index: 13167n, subindex: 0n } },
      });
      const res = await ctx.seal();
      expect(res.status).toBe(201);
      const { sealId } = (await res.json()) as { sealId: string };
      const view = (await (await ctx.app.request(`/v1/seals/${sealId}`)).json()) as {
        agent: { credential: { status: string; registry: string; registryUrl: string } };
      };
      expect(view.agent.credential).toEqual({
        status,
        registry: '<13167,0>',
        registryUrl: 'https://ccdexplorer.io/testnet/instance/13167/0',
      });
    }
  });
});
