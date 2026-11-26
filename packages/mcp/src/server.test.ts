import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CachetError, type Seal } from '@cachet/sdk';
import { createCachetMcpServer, type CachetMcpDeps } from './server';

const SEAL_ID = '01M89AG58PVJW8PJ5RQMP23PXA';
const SEAL: Seal = {
  sealId: SEAL_ID,
  company: 'Northwind Energy BV',
  code: '47-21',
  spokenCode: 'four-seven, two-one',
  firstLine: "Hi, this is Northwind Energy BV's AI assistant. Your Cachet code is four-seven, two-one.",
  issuedAt: '2026-11-26T10:20:00.000Z',
  expiresAt: '2026-11-26T10:35:00.000Z',
  verifyUrl: `https://getcachet.site/v/${SEAL_ID}`,
  creditsLeft: 143,
  x402Tx: null,
};

async function connect(over: Partial<CachetMcpDeps> = {}) {
  const calls: { sealCall: unknown[]; closeSeal: unknown[]; http: string[] } = {
    sealCall: [],
    closeSeal: [],
    http: [],
  };
  const server = createCachetMcpServer({
    cachet: {
      sealCall: async (input) => {
        calls.sealCall.push(input);
        return SEAL;
      },
      closeSeal: async (id, reason) => {
        calls.closeSeal.push([id, reason]);
        return 'closed';
      },
    },
    apiBase: 'https://api.test/',
    callerId: '+918035735856',
    token: 'EUDemo',
    http: (async (url: string) => {
      calls.http.push(url);
      if (url.includes('/v1/companies')) {
        const q = new URL(url).searchParams.get('query') ?? '';
        const companies = /demo/i.test(q)
          ? [
              {
                legalName: 'Demo Exchange',
                legalCountry: 'NL',
                neverCalls: true,
                proofTxUrl: 'https://x/tx',
                aiCallers: [],
              },
            ]
          : /north/i.test(q)
            ? [
                {
                  legalName: 'Northwind Energy BV',
                  legalCountry: 'NL',
                  neverCalls: false,
                  proofTxUrl: 'https://x/tx',
                  aiCallers: [
                    {
                      name: 'Northwind billing assistant',
                      callingNumbers: ['+918035735856'],
                      purposes: ['billing'],
                    },
                  ],
                },
              ]
            : [];
        return Response.json({ companies });
      }
      if (url.endsWith(`/v1/seals/${SEAL_ID}`)) {
        return Response.json({
          status: 'closed',
          signatureValid: true,
          company: { legalName: 'Northwind Energy BV', status: 'active' },
          agent: { name: 'Northwind billing assistant', onChain: 'active' },
          purpose: 'billing',
          message: 'Your November bill is ready',
          issuedAt: '2026-11-26T10:20:00Z',
          anchor: { status: 'finalized', txUrl: 'https://ccdexplorer.io/testnet/transaction/ff07' },
        });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch,
    ...over,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-agent', version: '1.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as {
      content: { type: string; text: string }[];
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    };
    return { ...r, text: r.content.map((c) => c.text).join('\n') };
  };
  return { client, call, calls };
}

describe('Cachet MCP server', () => {
  it('offers the four tools, with read-only hints on the checks', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual([
      'cachet_check_company',
      'cachet_check_seal',
      'cachet_close_seal',
      'cachet_seal_call',
    ]);
    expect(byName['cachet_check_company']?.annotations?.readOnlyHint).toBe(true);
    expect(byName['cachet_seal_call']?.description).toContain('very first sentence');
    expect(byName['cachet_seal_call']?.inputSchema.required).toEqual(['to', 'purpose', 'message']);
  });

  it('seals a call: uses the default calling number, the token for amounts, and returns the first line', async () => {
    const { call, calls } = await connect();
    const r = await call('cachet_seal_call', {
      to: '+919336124858',
      purpose: 'billing',
      message: 'Your November bill is ready',
      amount: '12.40',
    });
    expect(r.isError).toBeFalsy();
    expect(calls.sealCall[0]).toEqual({
      to: '+919336124858',
      from: '+918035735856',
      purpose: 'billing',
      message: 'Your November bill is ready',
      amount: { value: '12.40', asset: 'EUDemo' },
    });
    expect(r.text).toContain(`Say this first, word for word: "${SEAL.firstLine}"`);
    expect(r.structuredContent).toMatchObject({ sealId: SEAL_ID, code: '47-21', paidWithX402: null });
  });

  it('refuses bad input before anything is sent (number format, message length, purpose)', async () => {
    const { call, calls } = await connect();
    for (const args of [
      { to: '9336124858', purpose: 'billing', message: 'Hi' },
      { to: '+919336124858', purpose: 'billing', message: 'x'.repeat(81) },
      { to: '+919336124858', purpose: 'marketing', message: 'Hi' },
      { to: '+919336124858', purpose: 'billing', message: 'Hi', amount: '12,40' },
    ]) {
      const r = await call('cachet_seal_call', args);
      expect(r.isError).toBe(true);
    }
    expect(calls.sealCall).toHaveLength(0);
  });

  it('a refusal from Cachet tells the AI not to present the call as verified', async () => {
    const { call } = await connect({
      cachet: {
        sealCall: async () => {
          throw new CachetError(
            403,
            'consent_revoked',
            'This person has blocked verified AI calls from your company.',
          );
        },
        closeSeal: async () => 'closed',
      },
    });
    const r = await call('cachet_seal_call', { to: '+919336124858', purpose: 'billing', message: 'Hi' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('consent_revoked');
    expect(r.text).toContain('Do not present this call as verified');
  });

  it('no calling number anywhere → a clear error, nothing sent', async () => {
    const { call, calls } = await connect({ callerId: undefined });
    const r = await call('cachet_seal_call', { to: '+919336124858', purpose: 'billing', message: 'Hi' });
    expect(r.isError).toBe(true);
    expect(calls.sealCall).toHaveLength(0);
  });

  it('closes a seal', async () => {
    const { call, calls } = await connect();
    const r = await call('cachet_close_seal', { sealId: SEAL_ID, reason: 'completed' });
    expect(calls.closeSeal[0]).toEqual([SEAL_ID, 'completed']);
    expect(r.text).toBe(`Seal ${SEAL_ID} closed (completed).`);
  });

  it('checks companies: verified with numbers, never-calls = scam, unknown = not verified', async () => {
    const { call, calls } = await connect();
    expect((await call('cachet_check_company', { query: 'Northwind' })).text).toContain(
      'calls from +918035735856',
    );
    expect((await call('cachet_check_company', { query: 'Demo Exchange' })).text).toContain(
      'NEVER makes AI calls: any AI call claiming to be them is a scam',
    );
    expect((await call('cachet_check_company', { query: 'SBI' })).text).toContain('NOT verified');
    expect(calls.http[0]).toBe('https://api.test/v1/companies?query=Northwind');
  });

  it('checks a seal (public view), and an unknown id is a warning', async () => {
    const { call } = await connect();
    const r = await call('cachet_check_seal', { sealId: SEAL_ID });
    expect(r.text).toContain('switched on in the Concordium registry');
    expect(r.text).toContain('in the permanent record');
    const missing = await call('cachet_check_seal', { sealId: '01M89AG58PVJW8PJ5RQMP23PXB' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("don't trust it");
  });
});
