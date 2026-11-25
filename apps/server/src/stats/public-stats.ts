import { sql, type Db } from '@cachet/db';
import { explorerTxUrl, type Network } from '@cachet/shared';

/**
 * Live numbers for the public website: totals only. Never a phone number, a code, a person or a
 * single call's details. Everything here is also checkable on chain (the latest record links there).
 */
export interface PublicStats {
  network: Network;
  sealsTotal: number;
  sealsLast24h: number;
  /** Sealed calls whose seal is already inside a finalized on-chain record. */
  sealsInPublicRecord: number;
  companiesVerified: number;
  aiCallersActive: number;
  paymentsTotal: number;
  lastRecord: { txHash: string; txUrl: string; items: number; at: string } | null;
  updatedAt: string;
}

export interface StatsCounts {
  sealsTotal: number;
  sealsLast24h: number;
  sealsInPublicRecord: number;
  companiesVerified: number;
  aiCallersActive: number;
  paymentsTotal: number;
  lastAnchor: { txHash: string; items: number; at: Date } | null;
}

export interface StatsSource {
  read(since: Date): Promise<StatsCounts>;
}

const int = (v: unknown) => Number(v ?? 0);

/** One round trip; every count uses an index or a small table. */
export function createStatsSource(db: Db): StatsSource {
  return {
    async read(since) {
      const result = await db.execute(sql`
        select
          (select count(*) from seals) as seals_total,
          (select count(*) from seals where issued_at >= ${since.toISOString()}::timestamptz) as seals_24h,
          (select count(*) from ledger_items li join anchors a on a.id = li.anchor_id
             where li.kind = 'seal' and a.status = 'finalized') as seals_recorded,
          (select count(*) from businesses where status = 'active') as companies,
          (select count(*) from agents where status = 'active') as ai_callers,
          (select count(*) from payments) as payments,
          (select row_to_json(x) from (
             select tx_hash, item_count, finalized_at from anchors
             where status = 'finalized' and tx_hash is not null
             order by finalized_at desc nulls last, id desc limit 1) x) as last_anchor
      `);
      const row = (result.rows[0] ?? {}) as Record<string, unknown>;
      const last = row['last_anchor'] as
        { tx_hash: string; item_count: number; finalized_at: string | null } | null | undefined;
      return {
        sealsTotal: int(row['seals_total']),
        sealsLast24h: int(row['seals_24h']),
        sealsInPublicRecord: int(row['seals_recorded']),
        companiesVerified: int(row['companies']),
        aiCallersActive: int(row['ai_callers']),
        paymentsTotal: int(row['payments']),
        lastAnchor:
          last && last.finalized_at
            ? { txHash: last.tx_hash, items: int(last.item_count), at: new Date(last.finalized_at) }
            : null,
      };
    },
  };
}

/**
 * Cached for `ttlMs` (default 30 s), and concurrent requests share one database read, so a busy
 * landing page costs at most one query per 30 s.
 */
export function createPublicStats(opts: {
  source: StatsSource;
  network: Network;
  now?: () => Date;
  ttlMs?: number;
}) {
  const now = opts.now ?? (() => new Date());
  const ttl = opts.ttlMs ?? 30_000;
  let cached: { at: number; value: PublicStats } | null = null;
  let inFlight: Promise<PublicStats> | null = null;

  async function load(): Promise<PublicStats> {
    const at = now();
    const c = await opts.source.read(new Date(at.getTime() - 24 * 3600_000));
    return {
      network: opts.network,
      sealsTotal: c.sealsTotal,
      sealsLast24h: c.sealsLast24h,
      sealsInPublicRecord: c.sealsInPublicRecord,
      companiesVerified: c.companiesVerified,
      aiCallersActive: c.aiCallersActive,
      paymentsTotal: c.paymentsTotal,
      lastRecord: c.lastAnchor
        ? {
            txHash: c.lastAnchor.txHash,
            txUrl: explorerTxUrl(opts.network, c.lastAnchor.txHash),
            items: c.lastAnchor.items,
            at: c.lastAnchor.at.toISOString(),
          }
        : null,
      updatedAt: at.toISOString(),
    };
  }

  return {
    async get(): Promise<PublicStats> {
      const t = now().getTime();
      if (cached && t - cached.at < ttl) return cached.value;
      inFlight ??= load()
        .then((value) => {
          cached = { at: now().getTime(), value };
          return value;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
  };
}

export type PublicStatsService = ReturnType<typeof createPublicStats>;
