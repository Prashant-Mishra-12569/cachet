import { and, eq, isNull, ledgerItems, reports, type Db } from '@cachet/db';
import { canonicalize, sha256Hex } from '@cachet/shared/seal';

export interface NewReport {
  personId: string;
  phoneHash: string;
  sealId: string | null;
  reason: 'unverified_call';
  claimedCompany: string | null;
}

export interface ReportsRepo {
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
    async claim(reportId, personId, claimedCompany, claimedBusinessId) {
      const r = rows.find((x) => x.id === reportId && x.personId === personId && x.claimedCompany === null);
      if (!r) return false;
      r.claimedCompany = claimedCompany;
      r.claimedBusinessId = claimedBusinessId;
      return true;
    },
  };
}
