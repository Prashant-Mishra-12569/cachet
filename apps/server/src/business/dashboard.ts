import { createHash } from 'node:crypto';
import { sql, type Db } from '@cachet/db';
import { explorerTxUrl, type Network } from '@cachet/shared';

/**
 * The company dashboard and its compliance exports.
 *
 * Privacy rules (by design, not by policy):
 * - Cachet never stores the number a company called, so the company can't see it here either.
 * - Each person shows up as a short "person code" that is DIFFERENT for every company, so two
 *   companies can't put their lists side by side to link people.
 * - Call codes are never shown, not even to the company that made the call.
 */

// ───────────────────────── pure helpers ─────────────────────────

export type Outcome =
  'in_progress' | 'answered' | 'not_answered' | 'failed' | 'cancelled' | 'blocked' | 'replaced' | 'expired';

/** What happened to a sealed call, in words a company understands. */
export function outcomeOf(
  s: { status: string; closeReason: string | null; expiresAt: Date },
  now: Date,
): Outcome {
  if (s.status === 'superseded') return 'replaced';
  if (s.status === 'open') return s.expiresAt > now ? 'in_progress' : 'expired';
  switch (s.closeReason) {
    case 'completed':
      return 'answered';
    case 'no_answer':
      return 'not_answered';
    case 'cancelled':
      return 'cancelled';
    case 'blocked_by_callee':
      return 'blocked';
    default:
      return 'failed';
  }
}

/** A stable, per-company pseudonym for a person (8 hex). Never the number, never shared across companies. */
export function personRef(businessId: string, phoneHash: string): string {
  return createHash('sha256')
    .update(`cachet:person-ref:v1:${businessId}:${phoneHash}`)
    .digest('hex')
    .slice(0, 8);
}

/**
 * One CSV cell (RFC 4180). Cells that a spreadsheet would run as a formula (= + - @, tab, CR) get a
 * leading apostrophe, so an export can never execute anything when opened in Excel or Sheets.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let v = String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export const MAX_RANGE_DAYS = 366;

/**
 * "from" / "to" as YYYY-MM-DD (UTC days, "to" inclusive). Defaults to the last 30 days.
 * Returns null for nonsense (bad dates, from after to, more than a year).
 */
export function parseRange(
  from: string | undefined,
  to: string | undefined,
  now: Date,
): { from: Date; to: Date } | null {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = to ? (day.test(to) ? new Date(`${to}T00:00:00Z`) : null) : startOfDay(now);
  const start = from
    ? day.test(from)
      ? new Date(`${from}T00:00:00Z`)
      : null
    : end && new Date(end.getTime() - 29 * 86_400_000);
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const endExclusive = new Date(end.getTime() + 86_400_000);
  if (start >= endExclusive) return null;
  if ((endExclusive.getTime() - start.getTime()) / 86_400_000 > MAX_RANGE_DAYS) return null;
  return { from: start, to: endExclusive };
}

// ───────────────────────── data ─────────────────────────

export interface CallRow {
  id: string;
  issuedAt: Date;
  closedAt: Date | null;
  expiresAt: Date;
  status: string;
  closeReason: string | null;
  purpose: string;
  message: string;
  amountValue: string | null;
  amountAsset: string | null;
  fromE164: string;
  phoneHash: string;
  sealHash: string;
  consent: string | null;
  agentName: string;
  payTx: string | null;
  recordTx: string | null;
  recordStatus: string | null;
}

export interface Counts {
  total: number;
  answered: number;
  notAnswered: number;
  failed: number;
  cancelled: number;
  blocked: number;
  replaced: number;
  inProgress: number;
  expired: number;
}

export interface AgentRow {
  name: string;
  status: string;
  purposes: string[];
  callingNumbers: string[];
  language: string;
  badge: string | null;
  tokenId: string | null;
  registerTx: string | null;
  cardTx: string | null;
  agentWallet: string | null;
}

export interface DashboardSource {
  counts(businessId: string, from: Date, to: Date, now: Date): Promise<Counts>;
  perDay(
    businessId: string,
    days: number,
    now: Date,
  ): Promise<{ day: string; answered: number; other: number }[]>;
  payments(
    businessId: string,
    from: Date | null,
    limit: number,
  ): Promise<
    { sealId: string; txHash: string; payer: string; amount: string; asset: string; paidAt: Date }[]
  >;
  consents(businessId: string): Promise<{ granted: number; revoked: number }>;
  reports(
    businessId: string,
    from: Date | null,
    limit: number,
  ): Promise<{ sealId: string; reason: string; createdAt: Date }[]>;
  credits(businessId: string): Promise<number>;
  /** People who joined Cachet through this company's invite link (a count, nothing else). */
  invited(businessId: string): Promise<number>;
  /** Reports where a person said a scam caller pretended to be this company. */
  impersonations(businessId: string, from: Date, to?: Date): Promise<number>;
  recorded(businessId: string): Promise<{ sealed: number; inRecord: number }>;
  calls(
    businessId: string,
    range: { from: Date; to: Date },
    before: { issuedAt: Date; id: string } | null,
    limit: number,
  ): Promise<CallRow[]>;
  records(
    businessId: string,
    range: { from: Date; to: Date },
  ): Promise<{ txHash: string | null; status: string; items: number; finalizedAt: Date | null }[]>;
  agents(businessId: string): Promise<AgentRow[]>;
}

const n = (v: unknown) => Number(v ?? 0);
const iso = (d: Date) => d.toISOString();
type Rows = Record<string, unknown>[];

export function createDashboardSource(db: Db): DashboardSource {
  const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Rows;
  // Seals of this business: via its agents, so the (agent_id, issued_at) index is used.
  const ofBusiness = (b: string) => sql`s.agent_id in (select id from agents where business_id = ${b}::uuid)`;

  return {
    async counts(b, from, to, now) {
      const [r = {}] = await rows(sql`
        select count(*) as total,
          count(*) filter (where s.close_reason = 'completed') as answered,
          count(*) filter (where s.close_reason = 'no_answer') as not_answered,
          count(*) filter (where s.status = 'closed' and coalesce(s.close_reason, '') not in
            ('completed', 'no_answer', 'cancelled', 'blocked_by_callee')) as failed,
          count(*) filter (where s.close_reason = 'cancelled') as cancelled,
          count(*) filter (where s.close_reason = 'blocked_by_callee') as blocked,
          count(*) filter (where s.status = 'superseded') as replaced,
          count(*) filter (where s.status = 'open' and s.expires_at > ${iso(now)}::timestamptz) as in_progress,
          count(*) filter (where s.status = 'open' and s.expires_at <= ${iso(now)}::timestamptz) as expired
        from seals s
        where ${ofBusiness(b)}
          and s.issued_at >= ${iso(from)}::timestamptz and s.issued_at < ${iso(to)}::timestamptz`);
      return {
        total: n(r['total']),
        answered: n(r['answered']),
        notAnswered: n(r['not_answered']),
        failed: n(r['failed']),
        cancelled: n(r['cancelled']),
        blocked: n(r['blocked']),
        replaced: n(r['replaced']),
        inProgress: n(r['in_progress']),
        expired: n(r['expired']),
      };
    },

    async perDay(b, days, now) {
      // UTC days, oldest first, including days without calls.
      const today = iso(now).slice(0, 10);
      const sinceDay = iso(new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000)).slice(0, 10);
      const r = await rows(sql`
        select to_char(d, 'YYYY-MM-DD') as day,
          count(s.id) filter (where s.close_reason = 'completed') as answered,
          count(s.id) filter (where s.id is not null and coalesce(s.close_reason, '') <> 'completed') as other
        from generate_series(${sinceDay}::date, ${today}::date, interval '1 day') d
        left join seals s on ${ofBusiness(b)}
          and s.issued_at >= ${`${sinceDay}T00:00:00Z`}::timestamptz
          and (s.issued_at at time zone 'UTC')::date = d::date
        group by d order by d`);
      return r.map((x) => ({ day: String(x['day']), answered: n(x['answered']), other: n(x['other']) }));
    },

    async payments(b, from, limit) {
      const r = await rows(sql`
        select p.seal_id, p.tx_hash, p.payer, p.amount, p.asset, p.paid_at
        from payments p
        where p.business_id = ${b}::uuid ${from ? sql`and p.paid_at >= ${iso(from)}::timestamptz` : sql``}
        order by p.paid_at desc limit ${limit}`);
      return r.map((x) => ({
        sealId: String(x['seal_id']),
        txHash: String(x['tx_hash']),
        payer: String(x['payer']),
        amount: String(x['amount']),
        asset: String(x['asset']),
        paidAt: new Date(String(x['paid_at'])),
      }));
    },

    async consents(b) {
      const [r = {}] = await rows(sql`
        select count(*) filter (where status = 'granted') as granted,
               count(*) filter (where status = 'revoked') as revoked
        from consents where business_id = ${b}::uuid`);
      return { granted: n(r['granted']), revoked: n(r['revoked']) };
    },

    async reports(b, from, limit) {
      const r = await rows(sql`
        select r.seal_id, r.reason, r.created_at
        from reports r join seals s on s.id = r.seal_id
        where ${ofBusiness(b)} ${from ? sql`and r.created_at >= ${iso(from)}::timestamptz` : sql``}
        order by r.created_at desc limit ${limit}`);
      return r.map((x) => ({
        sealId: String(x['seal_id']),
        reason: String(x['reason']),
        createdAt: new Date(String(x['created_at'])),
      }));
    },

    async invited(b) {
      const [r = {}] = await rows(
        sql`select count(*) as n from people where invited_by_business_id = ${b}::uuid`,
      );
      return n(r['n']);
    },

    async impersonations(b, from, to) {
      const [r = {}] = await rows(sql`
        select count(*) as n from reports
        where claimed_business_id = ${b}::uuid and created_at >= ${iso(from)}::timestamptz
          ${to ? sql`and created_at < ${iso(to)}::timestamptz` : sql``}`);
      return n(r['n']);
    },

    async credits(b) {
      const [r = {}] = await rows(sql`
        select coalesce(sum(c.balance), 0) as credits
        from seal_credits c join agents a on a.id = c.agent_id where a.business_id = ${b}::uuid`);
      return n(r['credits']);
    },

    async recorded(b) {
      const [r = {}] = await rows(sql`
        select count(*) as sealed,
          count(*) filter (where an.status = 'finalized') as in_record
        from seals s
        left join ledger_items li on li.kind = 'seal' and li.ref_id = s.id
        left join anchors an on an.id = li.anchor_id
        where ${ofBusiness(b)}`);
      return { sealed: n(r['sealed']), inRecord: n(r['in_record']) };
    },

    async calls(b, range, before, limit) {
      const r = await rows(sql`
        select s.id, s.issued_at, s.closed_at, s.expires_at, s.status, s.close_reason, s.purpose, s.message,
          s.amount_value, s.amount_asset, s.from_e164, s.phone_hash, s.seal_hash,
          (s.seal_json::jsonb ->> 'consent') as consent,
          a.name as agent_name, p.tx_hash as pay_tx, an.tx_hash as record_tx, an.status as record_status
        from seals s
        join agents a on a.id = s.agent_id
        left join payments p on p.seal_id = s.id
        left join ledger_items li on li.kind = 'seal' and li.ref_id = s.id
        left join anchors an on an.id = li.anchor_id
        where ${ofBusiness(b)}
          and s.issued_at >= ${iso(range.from)}::timestamptz and s.issued_at < ${iso(range.to)}::timestamptz
          ${before ? sql`and (s.issued_at, s.id) < (${iso(before.issuedAt)}::timestamptz, ${before.id})` : sql``}
        order by s.issued_at desc, s.id desc
        limit ${limit}`);
      return r.map((x) => ({
        id: String(x['id']),
        issuedAt: new Date(String(x['issued_at'])),
        closedAt: x['closed_at'] ? new Date(String(x['closed_at'])) : null,
        expiresAt: new Date(String(x['expires_at'])),
        status: String(x['status']),
        closeReason: (x['close_reason'] as string | null) ?? null,
        purpose: String(x['purpose']),
        message: String(x['message']),
        amountValue: (x['amount_value'] as string | null) ?? null,
        amountAsset: (x['amount_asset'] as string | null) ?? null,
        fromE164: String(x['from_e164']),
        phoneHash: String(x['phone_hash']),
        sealHash: String(x['seal_hash']),
        consent: (x['consent'] as string | null) ?? null,
        agentName: String(x['agent_name']),
        payTx: (x['pay_tx'] as string | null) ?? null,
        recordTx: (x['record_tx'] as string | null) ?? null,
        recordStatus: (x['record_status'] as string | null) ?? null,
      }));
    },

    async records(b, range) {
      const r = await rows(sql`
        select an.tx_hash, an.status, an.finalized_at, count(*) as items
        from ledger_items li
        join seals s on s.id = li.ref_id and li.kind in ('seal', 'seal_closed')
        join anchors an on an.id = li.anchor_id
        where ${ofBusiness(b)}
          and s.issued_at >= ${iso(range.from)}::timestamptz and s.issued_at < ${iso(range.to)}::timestamptz
        group by an.id order by an.id`);
      return r.map((x) => ({
        txHash: (x['tx_hash'] as string | null) ?? null,
        status: String(x['status']),
        items: n(x['items']),
        finalizedAt: x['finalized_at'] ? new Date(String(x['finalized_at'])) : null,
      }));
    },

    async agents(b) {
      const r = await rows(sql`
        select name, status, purposes, calling_numbers, language, badge, token_id::text as token_id,
          register_tx, card_tx, agent_wallet
        from agents where business_id = ${b}::uuid order by created_at`);
      return r.map((x) => ({
        name: String(x['name']),
        status: String(x['status']),
        purposes: (x['purposes'] as string[]) ?? [],
        callingNumbers: (x['calling_numbers'] as string[]) ?? [],
        language: String(x['language']),
        badge: (x['badge'] as string | null) ?? null,
        tokenId: (x['token_id'] as string | null) ?? null,
        registerTx: (x['register_tx'] as string | null) ?? null,
        cardTx: (x['card_tx'] as string | null) ?? null,
        agentWallet: (x['agent_wallet'] as string | null) ?? null,
      }));
    },
  };
}

// ───────────────────────── views ─────────────────────────

export interface DashboardDeps {
  source: DashboardSource;
  network: Network;
  webOrigin: string;
  /** Concordium Agent Registry base URL, for the public badge-check link. */
  registryUrl?: string | undefined;
  now?: () => Date;
}

const OUTCOME_WORDS: Record<Outcome, string> = {
  in_progress: 'In progress',
  answered: 'Answered',
  not_answered: 'Not answered',
  failed: 'Did not connect',
  cancelled: 'Cancelled',
  blocked: 'Ended: the person blocked you',
  replaced: 'Replaced by a newer call',
  expired: 'Expired',
};

export function createDashboard(deps: DashboardDeps) {
  const now = deps.now ?? (() => new Date());
  const tx = (h: string | null) => (h ? explorerTxUrl(deps.network, h) : null);

  function callView(businessId: string, c: CallRow, at: Date) {
    const outcome = outcomeOf(c, at);
    return {
      id: c.id,
      issuedAt: iso(c.issuedAt),
      closedAt: c.closedAt ? iso(c.closedAt) : null,
      outcome,
      outcomeText: OUTCOME_WORDS[outcome],
      person: personRef(businessId, c.phoneHash),
      agent: c.agentName,
      purpose: c.purpose,
      message: c.message,
      amount: c.amountValue && c.amountAsset ? { value: c.amountValue, asset: c.amountAsset } : null,
      from: c.fromE164,
      consent: c.consent === 'granted' ? 'granted' : 'none_recorded',
      paid: c.payTx ? { txHash: c.payTx, txUrl: tx(c.payTx) } : null,
      record:
        c.recordTx && c.recordStatus === 'finalized'
          ? { status: 'finalized' as const, txHash: c.recordTx, txUrl: tx(c.recordTx) }
          : { status: 'pending' as const },
      sealHash: c.sealHash,
      publicUrl: `${deps.webOrigin}/v/${c.id}`,
    };
  }

  function agentView(a: AgentRow) {
    return {
      ...a,
      registerTxUrl: tx(a.registerTx),
      cardTxUrl: tx(a.cardTx),
      badgeCheckUrl:
        deps.registryUrl && a.badge
          ? `${deps.registryUrl}/v1/check-badge/${a.badge.split(':').at(-1) ?? ''}`
          : null,
    };
  }

  /** "Picked up" = answered out of the calls that rang to a clear result (answered or not answered). */
  const pickupRate = (c: Counts) =>
    c.answered + c.notAnswered > 0 ? Math.round((c.answered / (c.answered + c.notAnswered)) * 100) : null;

  return {
    async summary(businessId: string) {
      const at = now();
      const since30 = new Date(at.getTime() - 30 * 86_400_000);
      const since14 = new Date(at.getTime() - 14 * 86_400_000);
      const [counts, perDay, payments, consents, reports, credits, recorded, agents, last14, impersonations] =
        await Promise.all([
          deps.source.counts(businessId, since30, at, at),
          deps.source.perDay(businessId, 14, at),
          deps.source.payments(businessId, since30, 500),
          deps.source.consents(businessId),
          deps.source.reports(businessId, since30, 50),
          deps.source.credits(businessId),
          deps.source.recorded(businessId),
          deps.source.agents(businessId),
          deps.source.counts(businessId, since14, at, at),
          deps.source.impersonations(businessId, since30),
        ]);
      const collected = new Map<string, number>();
      for (const p of payments) collected.set(p.asset, (collected.get(p.asset) ?? 0) + Number(p.amount));
      const perDayAvg = last14.total / 14;
      return {
        period: { days: 30 },
        calls: counts,
        pickupRate: pickupRate(counts),
        perDay,
        payments: {
          count: payments.length,
          collected: [...collected].map(([asset, total]) => ({ asset, total: total.toFixed(2) })),
        },
        consents,
        reports: { count: reports.length, impersonations },
        credits: {
          left: credits,
          // At the last 14 days' pace. Null when there were no calls (nothing to project from).
          daysLeft: perDayAvg > 0 ? Math.floor(credits / perDayAvg) : null,
        },
        record: recorded,
        agents: agents.map(agentView),
        generatedAt: iso(at),
      };
    },

    async calls(
      businessId: string,
      range: { from: Date; to: Date },
      cursor: string | undefined,
      limit: number,
    ) {
      const at = now();
      const before = decodeCursor(cursor);
      const rowsOut = await deps.source.calls(businessId, range, before, limit + 1);
      const page = rowsOut.slice(0, limit);
      const last = page.at(-1);
      return {
        calls: page.map((c) => callView(businessId, c, at)),
        next: rowsOut.length > limit && last ? encodeCursor(last.issuedAt, last.id) : null,
      };
    },

    /** How many customers joined through the company's invite link. */
    invited: (businessId: string) => deps.source.invited(businessId),

    async payments(businessId: string) {
      const list = await deps.source.payments(businessId, null, 200);
      return {
        payments: list.map((p) => ({
          ...p,
          paidAt: iso(p.paidAt),
          txUrl: tx(p.txHash),
          publicUrl: `${deps.webOrigin}/v/${p.sealId}`,
        })),
      };
    },

    async reports(businessId: string) {
      const list = await deps.source.reports(businessId, null, 200);
      return {
        reports: list.map((r) => ({
          ...r,
          createdAt: iso(r.createdAt),
          publicUrl: `${deps.webOrigin}/v/${r.sealId}`,
        })),
      };
    },

    /** Everything for one period, for the printable compliance report. */
    async compliance(
      business: {
        id: string;
        legalName: string;
        legalCountry: string;
        concordiumAccount: string;
        issuer: string;
        proofTx: string;
        requestTx: string;
        verifiedAt: Date;
      },
      range: { from: Date; to: Date },
    ) {
      const at = now();
      const [counts, consents, records, agents, calls, reports, payments, impersonations] = await Promise.all(
        [
          deps.source.counts(business.id, range.from, range.to, at),
          deps.source.consents(business.id),
          deps.source.records(business.id, range),
          deps.source.agents(business.id),
          deps.source.calls(business.id, range, null, REPORT_CALL_LIMIT + 1),
          deps.source.reports(business.id, range.from, 1000),
          deps.source.payments(business.id, range.from, 5000),
          deps.source.impersonations(business.id, range.from, range.to),
        ],
      );
      const inRange = (d: Date) => d >= range.from && d < range.to;
      return {
        network: deps.network,
        generatedAt: iso(at),
        period: { from: iso(range.from), to: iso(range.to) },
        company: {
          legalName: business.legalName,
          legalCountry: business.legalCountry,
          account: business.concordiumAccount,
          issuer: business.issuer,
          verifiedAt: iso(business.verifiedAt),
          proofTx: business.proofTx,
          proofTxUrl: explorerTxUrl(deps.network, business.proofTx),
          requestTx: business.requestTx,
          requestTxUrl: explorerTxUrl(deps.network, business.requestTx),
        },
        agents: agents.map(agentView),
        totals: { ...counts, pickupRate: pickupRate(counts) },
        consents,
        reports: reports.filter((r) => inRange(r.createdAt)).length,
        impersonations,
        payments: payments.filter((p) => inRange(p.paidAt)).length,
        records: records.map((r) => ({
          ...r,
          finalizedAt: r.finalizedAt ? iso(r.finalizedAt) : null,
          txUrl: tx(r.txHash),
        })),
        calls: calls.slice(0, REPORT_CALL_LIMIT).map((c) => callView(business.id, c, at)),
        callsTruncated: calls.length > REPORT_CALL_LIMIT,
      };
    },

    /** Every call in the period as CSV (for spreadsheets and auditors). */
    async callsCsv(businessId: string, range: { from: Date; to: Date }) {
      const at = now();
      const list = await deps.source.calls(businessId, range, null, CSV_ROW_LIMIT);
      const header = [
        'seal_id',
        'issued_at_utc',
        'ended_at_utc',
        'outcome',
        'person_code',
        'ai_caller',
        'calling_number',
        'purpose',
        'message',
        'amount',
        'asset',
        'ai_disclosure',
        'consent',
        'payment_tx',
        'seal_sha256',
        'record_tx',
        'public_page',
      ];
      const body = list.map((c) => {
        const v = callView(businessId, c, at);
        return [
          v.id,
          v.issuedAt,
          v.closedAt,
          v.outcome,
          v.person,
          v.agent,
          v.from,
          v.purpose,
          v.message,
          v.amount?.value,
          v.amount?.asset,
          // The seal's first line (what the AI says first) tells the person it is an AI assistant.
          'in_seal_first_line',
          v.consent,
          v.paid?.txHash,
          v.sealHash,
          v.record.status === 'finalized' ? v.record.txHash : 'pending',
          v.publicUrl,
        ];
      });
      return { csv: toCsv(header, body), rows: list.length, truncated: list.length >= CSV_ROW_LIMIT };
    },
  };
}

export type Dashboard = ReturnType<typeof createDashboard>;

export const REPORT_CALL_LIMIT = 2000;
export const CSV_ROW_LIMIT = 50_000;

/** Opaque "load more" cursor: the last call's time + id. */
export function encodeCursor(issuedAt: Date, id: string): string {
  return Buffer.from(`${issuedAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): { issuedAt: Date; id: string } | null {
  if (!cursor || cursor.length > 200) return null;
  const [t, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!t || !id || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) return null;
  const issuedAt = new Date(t);
  return Number.isNaN(issuedAt.getTime()) ? null : { issuedAt, id };
}
