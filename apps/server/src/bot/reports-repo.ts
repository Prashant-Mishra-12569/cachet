import { and, eq, isNull, ledgerItems, reports, type Db } from '@cachet/db';
import { canonicalize, sha256Hex } from '@cachet/shared/seal';

export interface NewReport {
  personId: string;
  phoneHash: string;
  sealId: string | null;
  /** 'unverified_call' (no seal), or 'sealed_call:<category>' (a verified company's call). */
  reason: 'unverified_call' | `sealed_call:${SealedCallReport}`;
  claimedCompany: string | null;
}

/** Why someone reports a sealed (verified) call. */
export const SEALED_CALL_REPORTS = ['pressure', 'suspicious_request', 'not_who_they_said', 'other'] as const;
export type SealedCallReport = (typeof SEALED_CALL_REPORTS)[number];

export interface ReportsRepo {
  /**
   * A person reports a SEALED call they received. One per person per seal: null if they already did.
   * Saved with its ledger item (anchored later) in one transaction.
   */
  reportSeal(input: NewReport & { sealId: string }, now: Date): Promise<{ id: string } | null>;
  /** Save the report AND its ledger item (anchored on chain later) in one transaction. */
  create(input: NewReport, now: Date): Promise<{ id: string }>;
  /**
   * Add who the caller claimed to be. Only the reporter's own report, and only once.
   * `claimedBusinessId` is set when the name matched a verified company.
   */
  claim(
    reportId: string,
    personId: string,
    claimedCompany: string,
    claimedBusinessId: string | null,
  ): Promise<boolean>;
}

/** What gets anchored: a hash only. It carries no phone data (anchors never do). */
const ledgerHash = (id: string, input: NewReport, now: Date) =>
  sha256Hex(
    canonicalize({
      v: 'cachet-report/1',
      id,
      reason: input.reason,
      sealId: input.sealId,
      at: now.toISOString(),
    }),
  );

export function createReportsRepo(db: Db): ReportsRepo {
  return {
    async create(input, now) {
      return db.transaction(async (tx) => {
        const rows = await tx
          .insert(reports)
          .values({ ...input, createdAt: now })
          .returning({ id: reports.id });
        const id = rows[0]?.id;
        if (!id) throw new Error('report insert returned no id');
        await tx
          .insert(ledgerItems)
          .values({ kind: 'report', refId: id, itemHash: ledgerHash(id, input, now) });
        return { id };
      });
    },
    async reportSeal(input, now) {
      return db.transaction(async (tx) => {
        const rows = await tx
          .insert(reports)
          .values({ ...input, createdAt: now })
          .onConflictDoNothing()
          .returning({ id: reports.id });
        const id = rows[0]?.id;
        if (!id) return null; // already reported by this person
        await tx
          .insert(ledgerItems)
          .values({ kind: 'report', refId: id, itemHash: ledgerHash(id, input, now) });
        return { id };
      });
    },
    async claim(reportId, personId, claimedCompany, claimedBusinessId) {
      const rows = await db
        .update(reports)
        .set({ claimedCompany, claimedBusinessId })
        .where(and(eq(reports.id, reportId), eq(reports.personId, personId), isNull(reports.claimedCompany)))
        .returning({ id: reports.id });
      return rows.length === 1;
    },
  };
}

type MemoryReport = NewReport & { id: string; claimedBusinessId: string | null };

export function createMemoryReportsRepo(): ReportsRepo & { rows: MemoryReport[] } {
  const rows: MemoryReport[] = [];
  return {
    rows,
    async create(input) {
      const id = crypto.randomUUID();
      rows.push({ ...input, id, claimedBusinessId: null });
      return { id };
    },
    async reportSeal(input) {
      if (rows.some((x) => x.sealId === input.sealId && x.personId === input.personId)) return null;
      const id = crypto.randomUUID();
      rows.push({ ...input, id, claimedBusinessId: null });
      return { id };
    },
    async claim(reportId, personId, claimedCompany, claimedBusinessId) {
      const r = rows.find((x) => x.id === reportId && x.personId === personId && x.claimedCompany === null);
      if (!r) return false;
      r.claimedCompany = claimedCompany;
      r.claimedBusinessId = claimedBusinessId;
      return true;
    },
  };
}
