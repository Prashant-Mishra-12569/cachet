import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { clientIp, trustWebsiteProxy } from './middleware';

const SECRET = 'a-long-shared-secret-for-the-website-proxy-0123456789';

function app(secret: string | undefined, trustProxy = true) {
  const a = new Hono();
  a.use(trustWebsiteProxy(secret));
  a.get('/ip', (c) => c.text(clientIp(c, trustProxy)));
  return a;
}

const ask = async (a: Hono, headers: Record<string, string>) => (await a.request('/ip', { headers })).text();

describe('visitor IP behind the website proxy', () => {
  it('uses the forwarded visitor IP only with the right secret', async () => {
    const a = app(SECRET);
    const base = { 'x-forwarded-for': '10.0.0.1' };
    expect(
      await ask(a, { ...base, 'x-cachet-proxy-secret': SECRET, 'x-cachet-client-ip': '198.51.100.7' }),
    ).toBe('198.51.100.7');
    // Wrong secret, missing secret, or a junk IP: ignored (falls back to the connecting IP).
    expect(
      await ask(a, { ...base, 'x-cachet-proxy-secret': 'guess', 'x-cachet-client-ip': '198.51.100.7' }),
    ).toBe('10.0.0.1');
    expect(await ask(a, { ...base, 'x-cachet-client-ip': '198.51.100.7' })).toBe('10.0.0.1');
    expect(await ask(a, { ...base, 'x-cachet-proxy-secret': SECRET, 'x-cachet-client-ip': 'evil' })).toBe(
      '10.0.0.1',
    );
  });

  it('without a configured secret, the headers mean nothing', async () => {
    const a = app(undefined);
    expect(
      await ask(a, {
        'x-forwarded-for': '10.0.0.1',
        'x-cachet-proxy-secret': '',
        'x-cachet-client-ip': '198.51.100.7',
      }),
    ).toBe('10.0.0.1');
  });
});
