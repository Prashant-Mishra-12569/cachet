import { describe, expect, it } from 'vitest';
import { createSponsorWatch } from './sponsor-watch';

function setup(balances: (number | Error)[]) {
  const sent: string[] = [];
  const claimed = new Set<string>();
  const watch = createSponsorWatch({
    balance: async () => {
      const next = balances.shift();
      if (next instanceof Error) throw next;
      return next ?? 0;
    },
    address: '35sHhKYuw7zk3iKZZjysLEh8BarcwxAJ4pQcZVB8kT9i4pkB5z',
    lowCcd: 500,
    kv: { claim: async (k) => (claimed.has(k) ? false : (claimed.add(k), true)) },
    notify: async (t) => void sent.push(t),
    log: { warn: () => {}, error: () => {} },
  });
  return { watch, sent };
}

describe('sponsor balance watch', () => {
  it('healthy above the limit; low below it, with one alert per 6 hours', async () => {
    const { watch, sent } = setup([20_000, 120, 110]);
    expect(await watch.tick()).toBe('ok');
    expect(watch.healthy()).toBe(true);
    expect(await watch.tick()).toBe('low');
    expect(watch.healthy()).toBe(false);
    await watch.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('120.00 CCD');
  });

  it('a failed balance read is not an alarm', async () => {
    const { watch, sent } = setup([new Error('node down')]);
    expect(await watch.tick()).toBe('unknown');
    expect(watch.healthy()).toBe(true);
    expect(sent).toHaveLength(0);
  });
});
