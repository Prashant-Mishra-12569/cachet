import { sql, type Db } from '@cachet/db';

/**
 * Risk scoring: a verified company whose OWN sealed calls are reported by many different people is
 * suspended automatically. Its seals stop, its open cards end, its Web3 ID credential is revoked (by
 * the credential job) and the suspension is written to the permanent record.
 *
 * Fairness rules:
 * - Only reports about the company's own SEALED calls count, and only by the person who received that
 *   call, once per call. Scams that merely used the company's name never count against it.
 * - It takes several different people AND a share of everyone it called: one angry person or one
 *   competitor can't suspend a company.
 */
export interface RiskRule {
  /** Look-back window. */
  windowDays: number;
  /** At least this many different people reported its sealed calls… */
  minReporters: number;
  /** …and they are at least this share of the different people it called in the window. */
  minShare: number;
}

export const DEFAULT_RISK_RULE: RiskRule = { windowDays: 7, minReporters: 5, minShare: 0.1 };

export interface RiskCounts {
  /** Different people who reported its sealed calls in the window. */
  reporters: number;
  /** Different people it sealed calls to in the window. */
  called: number;
}

/** How many reporters would trigger a suspension for this many people called. */
export const suspendAt = (called: number, rule: RiskRule) =>
  Math.max(rule.minReporters, Math.ceil(called * rule.minShare));

export const shouldSuspend = (c: RiskCounts, rule: RiskRule) => c.reporters >= suspendAt(c.called, rule);

export interface RiskSource {
  counts(businessId: string, since: Date): Promise<RiskCounts>;
}

export function createRiskSource(db: Db): RiskSource {
  return {
    async counts(businessId, since) {
      const result = await db.execute(sql`
        select
          (select count(distinct r.person_id) from reports r join seals s on s.id = r.seal_id
             where s.business_id = ${businessId}::uuid and r.reason like 'sealed_call:%'
               and r.created_at >= ${since.toISOString()}::timestamptz) as reporters,
          (select count(distinct s.phone_hash) from seals s
             where s.business_id = ${businessId}::uuid and s.issued_at >= ${since.toISOString()}::timestamptz) as called`);
      const row = (result.rows[0] ?? {}) as Record<string, unknown>;
      return { reporters: Number(row['reporters'] ?? 0), called: Number(row['called'] ?? 0) };
    },
  };
}

export function createRiskEngine(deps: {
  source: RiskSource;
  businesses: {
    findById(id: string): Promise<{ id: string; status: 'active' | 'suspended'; legalName: string } | null>;
    setStatus(id: string, status: 'active' | 'suspended', reason: string, now: Date): Promise<unknown>;
  };
  /** End the company's open seals, so no card stays green. */
  endSeals: (businessId: string) => Promise<number>;
  rule?: RiskRule;
  now?: () => Date;
  log?: Pick<Console, 'log'>;
}) {
  const rule = deps.rule ?? DEFAULT_RISK_RULE;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? console;
  const since = () => new Date(now().getTime() - rule.windowDays * 86_400_000);

  return {
    rule,
    /** Current numbers for a company (dashboard). */
    async status(businessId: string) {
      const c = await deps.source.counts(businessId, since());
      return { ...c, suspendAt: suspendAt(c.called, rule), windowDays: rule.windowDays };
    },

    /** After a new report about one of its sealed calls: suspend if the rule is met. */
    async afterReport(businessId: string): Promise<'suspended' | 'ok'> {
      const business = await deps.businesses.findById(businessId);
      if (!business || business.status !== 'active') return 'ok';
      const c = await deps.source.counts(businessId, since());
      if (!shouldSuspend(c, rule)) return 'ok';
      const reason = `Automatic: ${c.reporters} people reported its sealed calls in ${rule.windowDays} days (of ${c.called} called)`;
      await deps.businesses.setStatus(businessId, 'suspended', reason, now());
      const ended = await deps.endSeals(businessId);
      log.log(`[risk] suspended ${business.legalName}: ${reason}; ended ${ended} open seals`);
      return 'suspended';
    },
  };
}

export type RiskEngine = ReturnType<typeof createRiskEngine>;
