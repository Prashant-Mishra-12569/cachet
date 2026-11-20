import { ledgerItems, reports, type Db } from '@cachet/db';
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
  };
}

export function createMemoryReportsRepo(): ReportsRepo & { rows: (NewReport & { id: string })[] } {
  const rows: (NewReport & { id: string })[] = [];
  return {
    rows,
    async create(input) {
      const id = crypto.randomUUID();
      rows.push({ ...input, id });
      return { id };
    },
  };
}
