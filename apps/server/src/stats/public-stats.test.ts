import { describe, expect, it } from 'vitest';
import { createPublicStats, type StatsCounts, type StatsSource } from './public-stats';

const TX = 'ff0787b6e35f41798bed8aeb6bc997787cc18d521760ed3f3c74661b6084a8ca';

function counting(counts: Partial<StatsCounts> = {}) {
  const calls: Date[] = [];
  const source: StatsSource = {
    async read(since) {
      calls.push(since);
      await new Promise((r) => setTimeout(r, 5));
      return {
        sealsTotal: 42,
        sealsLast24h: 7,
        sealsInPublicRecord: 40,
        companiesVerified: 1,
        aiCallersActive: 1,
        paymentsTotal: 3,
        lastAnchor: { txHash: TX, items: 6, at: new Date('2026-11-25T12:20:00Z') },
        ...counts,
      };
    },
  };
  return { source, calls };
}

describe('public stats', () => {
  it('maps totals and links the latest on-chain record to the explorer', async () => {
    const { source, calls } = counting();
    const stats = createPublicStats({
      source,
      network: 'testnet',
      now: () => new Date('2026-11-25T13:00:00Z'),
    });
    const s = await stats.get();
    expect(s).toMatchObject({ sealsTotal: 42, sealsLast24h: 7, sealsInPublicRecord: 40, paymentsTotal: 3 });
    expect(s.lastRecord).toEqual({
      txHash: TX,
      txUrl: `https://ccdexplorer.io/testnet/transaction/${TX}`,
      items: 6,
      at: '2026-11-25T12:20:00.000Z',
    });
    expect(calls[0]?.toISOString()).toBe('2026-11-24T13:00:00.000Z'); // "last 24 h"
  });

  it('a busy page costs one read per 30 s: concurrent requests share it, then it is cached', async () => {
    const { source, calls } = counting();
    let t = Date.parse('2026-11-25T13:00:00Z');
    const stats = createPublicStats({ source, network: 'testnet', now: () => new Date(t) });
    await Promise.all(Array.from({ length: 20 }, () => stats.get()));
    expect(calls).toHaveLength(1);
    t += 29_000;
    await stats.get();
    expect(calls).toHaveLength(1);
    t += 2_000;
    await stats.get();
    expect(calls).toHaveLength(2);
  });

  it('no on-chain record yet → null, and a failed read is not cached', async () => {
    let fail = true;
    const source: StatsSource = {
      async read() {
        if (fail) throw new Error('db down');
        return {
          sealsTotal: 0,
          sealsLast24h: 0,
          sealsInPublicRecord: 0,
          companiesVerified: 0,
          aiCallersActive: 0,
          paymentsTotal: 0,
          lastAnchor: null,
        };
      },
    };
    const stats = createPublicStats({ source, network: 'testnet' });
    await expect(stats.get()).rejects.toThrow('db down');
    fail = false;
    expect((await stats.get()).lastRecord).toBeNull();
  });
});
