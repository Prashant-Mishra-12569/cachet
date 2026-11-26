import { businesses, eq, ledgerItems, sql, type Db } from '@cachet/db';
import { canonicalize, sha256Hex } from '@cachet/shared/seal';

export interface BusinessRecord {
  id: string;
  concordiumAccount: string;
  legalName: string;
  legalCountry: string;
  issuer: string;
  proofTx: string;
  requestTx: string;
  status: 'active' | 'suspended';
  neverCalls: boolean;
  verifiedAt: Date;
}

export interface VerifiedCompanyInput {
  concordiumAccount: string;
  legalName: string;
  legalCountry: string;
  issuer: string;
  proofTx: string;
  requestTx: string;
  verifiedAt: Date;
}

export interface BusinessRepo {
  findByAccount(account: string): Promise<BusinessRecord | null>;
  findById(id: string): Promise<BusinessRecord | null>;
  /** Verified companies whose legal name contains `query` (case-insensitive). */
  searchByName(query: string, limit: number): Promise<BusinessRecord[]>;
  /** Create the business, or refresh its proven details if it proves again. */
  upsertVerified(input: VerifiedCompanyInput): Promise<BusinessRecord>;
  /**
   * "We never make AI calls" on/off. The change goes into the permanent record (a ledger item,
   * anchored on chain later), so a company can't quietly deny it said so.
   */
  setNeverCalls(id: string, neverCalls: boolean, now: Date): Promise<BusinessRecord>;
}

/** What gets anchored for a "never calls" change: a hash of the declaration, nothing personal. */
export const neverCallsLedgerHash = (id: string, neverCalls: boolean, at: Date) =>
  sha256Hex(
    canonicalize({ v: 'cachet-company-never-calls/1', businessId: id, neverCalls, at: at.toISOString() }),
  );

export function createBusinessRepo(db: Db): BusinessRepo {
  return {
    async findByAccount(account) {
      const rows = await db
        .select()
        .from(businesses)
        .where(eq(businesses.concordiumAccount, account))
        .limit(1);
      return rows[0] ?? null;
    },
    async searchByName(query, limit) {
      // Escape LIKE wildcards so "%" or "_" in a query are matched literally.
      const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      return db
        .select()
        .from(businesses)
        .where(sql`${businesses.legalName} ilike ${pattern}`)
        .orderBy(businesses.legalName)
        .limit(limit);
    },
    async findById(id) {
      const rows = await db.select().from(businesses).where(eq(businesses.id, id)).limit(1);
      return rows[0] ?? null;
    },
    async upsertVerified(input) {
      const rows = await db
        .insert(businesses)
        .values(input)
        .onConflictDoUpdate({
          target: businesses.concordiumAccount,
          set: {
            legalName: input.legalName,
            legalCountry: input.legalCountry,
            issuer: input.issuer,
            proofTx: input.proofTx,
            requestTx: input.requestTx,
            verifiedAt: input.verifiedAt,
            updatedAt: sql`now()`,
          },
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('upsert returned no row');
      return row;
    },
    async setNeverCalls(id, neverCalls, now) {
      return db.transaction(async (tx) => {
        const rows = await tx
          .update(businesses)
          .set({ neverCalls, updatedAt: now })
          .where(eq(businesses.id, id))
          .returning();
        const row = rows[0];
        if (!row) throw new Error('business not found');
        await tx.insert(ledgerItems).values({
          kind: 'company_never_calls',
          refId: id,
          itemHash: neverCallsLedgerHash(id, neverCalls, now),
        });
        return row;
      });
    },
  };
}

/** In-memory repo for tests. */
export function createMemoryBusinessRepo(): BusinessRepo {
  const byAccount = new Map<string, BusinessRecord>();
  return {
    findByAccount: async (account) => byAccount.get(account) ?? null,
    findById: async (id) => [...byAccount.values()].find((b) => b.id === id) ?? null,
    searchByName: async (query, limit) =>
      [...byAccount.values()]
        .filter((b) => b.legalName.toLowerCase().includes(query.toLowerCase()))
        .slice(0, limit),
    async upsertVerified(input) {
      const existing = byAccount.get(input.concordiumAccount);
      const record: BusinessRecord = {
        id: existing?.id ?? crypto.randomUUID(),
        status: existing?.status ?? 'active',
        neverCalls: existing?.neverCalls ?? false,
        ...input,
      };
      byAccount.set(input.concordiumAccount, record);
      return record;
    },
    async setNeverCalls(id, neverCalls) {
      const b = [...byAccount.values()].find((x) => x.id === id);
      if (!b) throw new Error('business not found');
      const next = { ...b, neverCalls };
      byAccount.set(b.concordiumAccount, next);
      return next;
    },
  };
}
