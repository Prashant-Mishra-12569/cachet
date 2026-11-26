import { describe, expect, it } from 'vitest';
import { makeTestApp, signIn, signInAsCompany } from '../api/test-helpers';
import {
  createDashboard,
  csvCell,
  decodeCursor,
  encodeCursor,
  outcomeOf,
  parseRange,
  personRef,
  toCsv,
  type CallRow,
  type Counts,
  type DashboardSource,
} from './dashboard';

const NOW = new Date('2026-11-26T12:00:00Z');
const B1 = '11111111-1111-4111-8111-111111111111';
const B2 = '22222222-2222-4222-8222-222222222222';
const HASH = 'ab'.repeat(32);
const TX = 'cd'.repeat(32);

describe('call outcome', () => {
  const at = (status: string, closeReason: string | null, expiresInMin = 10) => ({
    status,
    closeReason,
    expiresAt: new Date(NOW.getTime() + expiresInMin * 60_000),
  });
  it.each([
    [at('open', null), 'in_progress'],
    [at('open', null, -1), 'expired'],
    [at('superseded', null), 'replaced'],
    [at('closed', 'completed'), 'answered'],
    [at('closed', 'no_answer'), 'not_answered'],
    [at('closed', 'cancelled'), 'cancelled'],
    [at('closed', 'blocked_by_callee'), 'blocked'],
    [at('closed', 'failed'), 'failed'],
    [at('closed', 'something_new'), 'failed'],
  ])('%j → %s', (seal, expected) => {
    expect(outcomeOf(seal, NOW)).toBe(expected);
  });
});

describe('person code', () => {
  it('is stable for one company, different across companies, and never the fingerprint itself', () => {
    const a = personRef(B1, HASH);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(personRef(B1, HASH)).toBe(a);
    expect(personRef(B2, HASH)).not.toBe(a); // two companies can't link the same person
    expect(HASH).not.toContain(a);
  });
});

describe('CSV', () => {
  it('quotes commas, quotes and line breaks (RFC 4180)', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12.4)).toBe('12.4');
  });

  it('defuses spreadsheet formulas, so an export can never run anything', () => {
    for (const evil of ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd']) {
      expect(csvCell(evil).replace(/^"/, '').startsWith("'")).toBe(true);
    }
    // Phone numbers start with + and must still be readable (just not a formula).
    expect(csvCell('+31201234567')).toBe("'+31201234567");
  });

  it('builds rows with CRLF line ends', () => {
    expect(toCsv(['a', 'b'], [[1, 'x,y']])).toBe('a,b\r\n1,"x,y"\r\n');
  });
});

describe('date range', () => {
  it('defaults to the last 30 days, end day included', () => {
    const r = parseRange(undefined, undefined, NOW);
    expect(r?.from.toISOString()).toBe('2026-10-28T00:00:00.000Z');
    expect(r?.to.toISOString()).toBe('2026-11-27T00:00:00.000Z');
  });
  it('takes explicit days (to is inclusive)', () => {
    const r = parseRange('2026-11-01', '2026-11-01', NOW);
    expect(r?.from.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(r?.to.toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });
  it.each([
    ['2026-11-10', '2026-11-01'], // backwards
    ['2025-01-01', '2026-11-01'], // more than a year
    ['yesterday', undefined],
    ['2026-13-45', undefined],
    ["2026-11-01' or 1=1", undefined],
  ])('refuses %s → %s', (from, to) => {
    expect(parseRange(from, to, NOW)).toBeNull();
  });
});

describe('load-more cursor', () => {
  it('round-trips and refuses anything else', () => {
    const id = '01M89AG58PVJW8PJ5RQMP23PXA';
    const c = encodeCursor(NOW, id);
    expect(decodeCursor(c)).toEqual({ issuedAt: NOW, id });
    expect(decodeCursor('garbage')).toBeNull();
    expect(decodeCursor(Buffer.from(`${NOW.toISOString()}|x' or 1=1`).toString('base64url'))).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
});

// ───────────── views over a fake data source ─────────────

const ZERO: Counts = {
  total: 0,
  answered: 0,
  notAnswered: 0,
  failed: 0,
  cancelled: 0,
  blocked: 0,
  replaced: 0,
  inProgress: 0,
  expired: 0,
};

function call(over: Partial<CallRow> = {}): CallRow {
  return {
    id: '01M89AG58PVJW8PJ5RQMP23PXA',
    issuedAt: new Date('2026-11-25T12:20:00Z'),
    closedAt: new Date('2026-11-25T12:21:00Z'),
    expiresAt: new Date('2026-11-25T12:35:00Z'),
    status: 'closed',
    closeReason: 'completed',
    purpose: 'billing',
    message: 'Your November bill is ready',
    amountValue: '12.40',
    amountAsset: 'EUDemo',
    fromE164: '+918035735856',
    phoneHash: HASH,
    sealHash: 'ef'.repeat(32),
    consent: 'none_recorded',
    agentName: 'Northwind billing assistant',
    payTx: TX,
    recordTx: TX,
    recordStatus: 'finalized',
    ...over,
  };
}

function fakeSource(over: Partial<DashboardSource> = {}): DashboardSource {
  return {
    counts: async () => ({ ...ZERO, total: 10, answered: 6, notAnswered: 2, failed: 1, replaced: 1 }),
    perDay: async () => [{ day: '2026-11-26', answered: 2, other: 1 }],
    payments: async () => [
      { sealId: 'S1', txHash: TX, payer: 'P', amount: '12.40', asset: 'EUDemo', paidAt: NOW },
      { sealId: 'S2', txHash: TX, payer: 'P', amount: '1.50', asset: 'EUDemo', paidAt: NOW },
    ],
    consents: async () => ({ granted: 3, revoked: 1 }),
    reports: async () => [],
    credits: async () => 140,
    impersonations: async () => 2,
    invited: async () => 3,
    recorded: async () => ({ sealed: 72, inRecord: 72 }),
    calls: async () => [call()],
    records: async () => [{ txHash: TX, status: 'finalized', items: 6, finalizedAt: NOW }],
    agents: async () => [
      {
        name: 'Northwind billing assistant',
        status: 'active',
        purposes: ['billing'],
        callingNumbers: ['+918035735856'],
        language: 'en',
        badge: 'JyP9UD2cnf5bw2YzH1GTX',
        tokenId: '1297',
        registerTx: TX,
        cardTx: TX,
        agentWallet: '3tCvWPDYchFULvGXKc6Q3MzofopAgMzzL3KeRU66G2dM2LqcNa',
      },
    ],
    ...over,
  };
}

const dash = (over: Partial<DashboardSource> = {}) =>
  createDashboard({
    source: fakeSource(over),
    network: 'testnet',
    webOrigin: 'https://getcachet.site',
    registryUrl: 'https://registry.test',
    now: () => NOW,
  });

describe('dashboard views', () => {
  it('summary: pickup rate, money collected, credits forecast, explorer and badge-check links', async () => {
    const s = await dash().summary(B1);
    expect(s.pickupRate).toBe(75); // 6 answered of 8 that rang to a clear result
    expect(s.payments).toEqual({ count: 2, collected: [{ asset: 'EUDemo', total: '13.90' }] });
    expect(s.credits).toEqual({ left: 140, daysLeft: 196 }); // 10 calls / 14 days → 140 credits ≈ 196 days
    expect(s.agents[0]?.registerTxUrl).toBe(`https://ccdexplorer.io/testnet/transaction/${TX}`);
    expect(s.agents[0]?.badgeCheckUrl).toBe('https://registry.test/v1/check-badge/JyP9UD2cnf5bw2YzH1GTX');
  });

  it('no calls yet: no pickup rate and no forecast (never a made-up number)', async () => {
    const s = await dash({ counts: async () => ZERO }).summary(B1);
    expect(s.pickupRate).toBeNull();
    expect(s.credits.daysLeft).toBeNull();
  });

  it('a call: person code, outcome words, record link; never the number called or the call code', async () => {
    const { calls } = await dash().calls(B1, { from: NOW, to: NOW }, undefined, 50);
    const c = calls[0];
    expect(c).toMatchObject({
      outcome: 'answered',
      outcomeText: 'Answered',
      person: personRef(B1, HASH),
      paid: { txHash: TX },
      record: { status: 'finalized', txHash: TX },
      publicUrl: 'https://getcachet.site/v/01M89AG58PVJW8PJ5RQMP23PXA',
    });
    const text = JSON.stringify(c);
    expect(text).not.toContain(HASH);
    expect(text).not.toMatch(/"code"/);
  });

  it('a record that is not final yet shows as pending, never as proven', async () => {
    const { calls } = await dash({ calls: async () => [call({ recordStatus: 'submitted' })] }).calls(
      B1,
      { from: NOW, to: NOW },
      undefined,
      50,
    );
    expect(calls[0]?.record).toEqual({ status: 'pending' });
  });

  it('pages: asks for one extra row to know if there is more', async () => {
    const rows = [call({ id: '01M89AG58PVJW8PJ5RQMP23PXA' }), call({ id: '01M89AG58PVJW8PJ5RQMP23PXB' })];
    let asked = 0;
    const d = dash({
      calls: async (_b, _r, _c, limit) => {
        asked = limit;
        return rows.slice(0, limit);
      },
    });
    const page = await d.calls(B1, { from: NOW, to: NOW }, undefined, 1);
    expect(asked).toBe(2);
    expect(page.calls).toHaveLength(1);
    expect(decodeCursor(page.next ?? '')?.id).toBe('01M89AG58PVJW8PJ5RQMP23PXA');
  });

  it('CSV: one row per call, AI disclosure stated, no number called', async () => {
    const { csv, rows } = await dash().callsCsv(B1, { from: NOW, to: NOW });
    const [header, line] = csv.trim().split('\r\n');
    expect(rows).toBe(1);
    expect(header).toContain('ai_disclosure');
    expect(line).toContain('answered');
    expect(line).toContain('in_seal_first_line'); // states where the disclosure is, not that it was heard
    expect(line).toContain(`${personRef(B1, HASH)}`);
    expect(line).not.toContain(HASH);
  });
});

// ───────────── routes ─────────────

describe('dashboard routes', () => {
  const app = () => makeTestApp({ dashboard: dash() }).app;

  it('need a signed-in session', async () => {
    for (const path of ['/v1/business/dashboard', '/v1/business/dashboard/export/calls.csv']) {
      expect((await app().request(path)).status).toBe(401);
    }
  });

  it('need a proven company', async () => {
    const a = app();
    const cookie = await signIn(a);
    const res = await a.request('/v1/business/dashboard', { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it('summary for the signed-in company, never cached', async () => {
    const a = app();
    const cookie = await signInAsCompany(a);
    const res = await a.request('/v1/business/dashboard', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(((await res.json()) as { pickupRate: number }).pickupRate).toBe(75);
  });

  it('CSV download: attachment, UTF-8 with BOM, dated file name', async () => {
    const a = app();
    const cookie = await signInAsCompany(a);
    const res = await a.request('/v1/business/dashboard/export/calls.csv?from=2026-11-01&to=2026-11-25', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="cachet-calls_2026-11-01_2026-11-25.csv"',
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('a bad period is a clear 400', async () => {
    const a = app();
    const cookie = await signInAsCompany(a);
    const res = await a.request('/v1/business/dashboard/calls?from=2026-12-01&to=2026-11-01', {
      headers: { cookie },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_range');
  });
});

describe('reports about the company (privacy of the people who report)', () => {
  it('gives totals per kind only: never which call, so the company cannot tell who reported', async () => {
    const d = createDashboard({
      source: {
        ...fakeSource(),
        reports: async () => [
          { sealId: '01M8C3WHX53Z1ZNXK3TB79KBE2', reason: 'sealed_call:pressure', createdAt: new Date() },
          { sealId: '01M8C3WHX53Z1ZNXK3TB79KBE3', reason: 'sealed_call:pressure', createdAt: new Date() },
          { sealId: '01M8C3WHX53Z1ZNXK3TB79KBE4', reason: 'sealed_call:other', createdAt: new Date() },
        ],
      },
      network: 'testnet',
      webOrigin: 'https://getcachet.site',
    });
    const r = await d.reports('biz');
    expect(r).toEqual({ total: 3, byKind: { pressure: 2, other: 1 } });
    expect(JSON.stringify(r)).not.toContain('01M8C3WHX53Z1ZNXK3TB79KBE');
  });
});
