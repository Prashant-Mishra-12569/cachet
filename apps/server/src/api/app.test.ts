import { describe, expect, it } from 'vitest';
import { makeTestApp } from './test-helpers';

describe('GET /healthz', () => {
  it('reports ok with the testnet chain id and store status', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      service: 'cachet',
      version: 'test',
      network: 'testnet',
      chain: 'ccd:4221332d34e1694168c2a0c0b3fd0f27',
      redis: 'ok',
    });
  });

  it('sends security headers', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/healthz');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('unknown routes', () => {
  it('return the plain-English JSON error shape', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'This page does not exist.' } });
  });
});
