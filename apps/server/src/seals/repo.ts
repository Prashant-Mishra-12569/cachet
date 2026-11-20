import {
  and,
  creditPurchases,
  desc,
  eq,
  ledgerItems,
  sealCredits,
  seals,
  sql,
  type Db,
  type SealRow,
} from '@cachet/db';

export type { SealRow };

export interface LedgerItemInput {
  kind: 'seal' | 'seal_closed';
  refId: string;
  itemHash: string;
}

export type IssueResult =
  { ok: true; creditsLeft: number } | { ok: false; reason: 'no_credits' | 'conflict' };

export interface SealRepo {
  /**
   * In ONE transaction: spend one credit, supersede the agent's open seals for this callee, insert the
   * seal and its ledger item. Nothing is written if there is no credit.
   */
  issue(seal: typeof seals.$inferInsert, ledger: LedgerItemInput): Promise<IssueResult>;
  get(id: string): Promise<SealRow | null>;
  /** Close an open seal of this agent. Null if it was not open (or not this agent's). */
  close(
    id: string,
    agentId: string,
    closedAt: Date,
    reason: string,
    ledger: LedgerItemInput,
  ): Promise<SealRow | null>;
  /** A callee's most recent seals, any status (for /history). */
  historyForPhone(phoneHash: string, limit: number): Promise<SealRow[]>;
  /** Companies that sealed calls to this callee since `since` (for /consent). */
  businessesForPhone(phoneHash: string, since: Date): Promise<string[]>;
  /** Open seals for a callee right now (for /check, Phase 3). */
  openForPhone(phoneHash: string, now: Date): Promise<SealRow[]>;
  creditBalance(agentId: string): Promise<number>;
  /** Record a paid purchase (tx can be used once) and add the credits. False if the tx was already used. */
  addCredits(input: {
    agentId: string;
    credits: number;
    amount: string;
    asset: string;
    txHash: string;
  }): Promise<boolean>;
  /** The most recent credit purchase transaction for this agent (seal.payment.ref). */
  latestPurchaseTx(agentId: string): Promise<string | null>;
}

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e.code ?? e.cause?.code) === '23505';
};

export function createSealRepo(db: Db): SealRepo {
  const issueTx = (seal: typeof seals.$inferInsert, ledger: LedgerItemInput): Promise<IssueResult> =>
    db.transaction(async (tx) => {
      const spent = await tx
        .update(sealCredits)
        .set({ balance: sql`${sealCredits.balance} - 1`, updatedAt: sql`now()` })
        .where(and(eq(sealCredits.agentId, seal.agentId), sql`${sealCredits.balance} > 0`))
        .returning({ balance: sealCredits.balance });
      const left = spent[0];
      if (!left) return { ok: false, reason: 'no_credits' } as const;

      await tx
        .update(seals)
        .set({ status: 'superseded', closedAt: seal.issuedAt, closeReason: 'superseded' })
        .where(
          and(eq(seals.agentId, seal.agentId), eq(seals.phoneHash, seal.phoneHash), eq(seals.status, 'open')),
        );
      await tx.insert(seals).values(seal);
      await tx.insert(ledgerItems).values(ledger);
      return { ok: true, creditsLeft: left.balance } as const;
    });

  return {
    async issue(seal, ledger) {
      try {
        return await issueTx(seal, ledger);
      } catch (err) {
        // Another seal for the same agent + callee won the race (one open seal per callee).
        if (isUniqueViolation(err)) return { ok: false, reason: 'conflict' } as const;
        throw err;
      }
    },

    async get(id) {
      const rows = await db.select().from(seals).where(eq(seals.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async close(id, agentId, closedAt, reason, ledger) {
      return db.transaction(async (tx) => {
        const rows = await tx
          .update(seals)
          .set({ status: 'closed', closedAt, closeReason: reason })
          .where(and(eq(seals.id, id), eq(seals.agentId, agentId), eq(seals.status, 'open')))
          .returning();
        const row = rows[0];
        if (!row) return null;
        await tx.insert(ledgerItems).values(ledger);
        return row;
      });
    },

    async historyForPhone(phoneHash, limit) {
      return (
        db
          .select()
          .from(seals)
          .where(eq(seals.phoneHash, phoneHash))
          // issuedAt has whole seconds; the ULID id breaks ties to the millisecond.
          .orderBy(desc(seals.issuedAt), desc(seals.id))
          .limit(limit)
      );
    },

    async businessesForPhone(phoneHash, since) {
      const rows = await db
        .selectDistinct({ businessId: seals.businessId })
        .from(seals)
        .where(and(eq(seals.phoneHash, phoneHash), sql`${seals.issuedAt} >= ${since}`));
      return rows.map((r) => r.businessId);
    },

    async openForPhone(phoneHash, now) {
      return db
        .select()
        .from(seals)
        .where(
          and(eq(seals.phoneHash, phoneHash), eq(seals.status, 'open'), sql`${seals.expiresAt} > ${now}`),
        )
        .orderBy(desc(seals.issuedAt), desc(seals.id));
    },

    async creditBalance(agentId) {
      const rows = await db.select().from(sealCredits).where(eq(sealCredits.agentId, agentId)).limit(1);
      return rows[0]?.balance ?? 0;
    },

    async addCredits(input) {
      try {
        await db.transaction(async (tx) => {
          await tx.insert(creditPurchases).values(input);
          await tx
            .insert(sealCredits)
            .values({ agentId: input.agentId, balance: input.credits })
            .onConflictDoUpdate({
              target: sealCredits.agentId,
              set: { balance: sql`${sealCredits.balance} + ${input.credits}`, updatedAt: sql`now()` },
            });
        });
        return true;
      } catch (err) {
        if (isUniqueViolation(err)) return false;
        throw err;
      }
    },

    async latestPurchaseTx(agentId) {
      const rows = await db
        .select({ tx: creditPurchases.txHash })
        .from(creditPurchases)
        .where(eq(creditPurchases.agentId, agentId))
        .orderBy(desc(creditPurchases.id))
        .limit(1);
      return rows[0]?.tx ?? null;
    },
  };
}

/** Same order as the SQL: issuedAt desc, then id desc (ULIDs sort by creation time). */
const newestFirst = (a: SealRow, b: SealRow) =>
  b.issuedAt.getTime() - a.issuedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** In-memory version for tests (same rules, no database). */
export function createMemorySealRepo() {
  const sealRows = new Map<string, SealRow>();
  const ledger: (LedgerItemInput & { anchorId: number | null; leafIndex: number | null })[] = [];
  const credits = new Map<string, number>();
  const purchases: { agentId: string; txHash: string }[] = [];

  const repo: SealRepo & { sealRows: typeof sealRows; ledger: typeof ledger; credits: typeof credits } = {
    sealRows,
    ledger,
    credits,
    async issue(seal, item) {
      const balance = credits.get(seal.agentId) ?? 0;
      if (balance <= 0) return { ok: false, reason: 'no_credits' };
      credits.set(seal.agentId, balance - 1);
      for (const s of sealRows.values()) {
        if (s.agentId === seal.agentId && s.phoneHash === seal.phoneHash && s.status === 'open') {
          sealRows.set(s.id, {
            ...s,
            status: 'superseded',
            closedAt: seal.issuedAt,
            closeReason: 'superseded',
          });
        }
      }
      sealRows.set(seal.id, {
        status: 'open',
        closedAt: null,
        closeReason: null,
        amountValue: null,
        amountAsset: null,
        createdAt: new Date(),
        ...seal,
      } as SealRow);
      ledger.push({ ...item, anchorId: null, leafIndex: null });
      return { ok: true, creditsLeft: balance - 1 };
    },
    get: async (id) => sealRows.get(id) ?? null,
    async close(id, agentId, closedAt, reason, item) {
      const s = sealRows.get(id);
      if (!s || s.agentId !== agentId || s.status !== 'open') return null;
      const next = { ...s, status: 'closed' as const, closedAt, closeReason: reason };
      sealRows.set(id, next);
      ledger.push({ ...item, anchorId: null, leafIndex: null });
      return next;
    },
    historyForPhone: async (phoneHash, limit) =>
      [...sealRows.values()]
        .filter((s) => s.phoneHash === phoneHash)
        .sort(newestFirst)
        .slice(0, limit),
    businessesForPhone: async (phoneHash, since) => [
      ...new Set(
        [...sealRows.values()]
          .filter((s) => s.phoneHash === phoneHash && s.issuedAt >= since)
          .map((s) => s.businessId),
      ),
    ],
    openForPhone: async (phoneHash, now) =>
      [...sealRows.values()]
        .filter((s) => s.phoneHash === phoneHash && s.status === 'open' && s.expiresAt > now)
        .sort(newestFirst),
    creditBalance: async (agentId) => credits.get(agentId) ?? 0,
    async addCredits(input) {
      if (purchases.some((p) => p.txHash === input.txHash)) return false;
      purchases.push(input);
      credits.set(input.agentId, (credits.get(input.agentId) ?? 0) + input.credits);
      return true;
    },
    latestPurchaseTx: async (agentId) =>
      purchases.filter((p) => p.agentId === agentId).at(-1)?.txHash ?? null,
  };
  return repo;
}
