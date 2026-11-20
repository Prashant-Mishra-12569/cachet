import { eq, ledgerItems, payments, type Db, type PaymentRow } from '@cachet/db';

export type { PaymentRow };
export type NewPayment = Omit<PaymentRow, 'id' | 'paidAt'> & { paidAt: Date };

export interface PaymentsRepo {
  forSeal(sealId: string): Promise<PaymentRow | null>;
  /**
   * Save a checked, finalized payment and its ledger item (one transaction). If this seal or this
   * transaction was already recorded, nothing is written and the existing row is returned.
   */
  record(payment: NewPayment, ledgerItemHash: string): Promise<{ row: PaymentRow; created: boolean }>;
}

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';

export function createPaymentsRepo(db: Db): PaymentsRepo {
  async function forSeal(sealId: string) {
    const rows = await db.select().from(payments).where(eq(payments.sealId, sealId)).limit(1);
    return rows[0] ?? null;
  }
  return {
    forSeal,
    async record(payment, ledgerItemHash) {
      try {
        const row = await db.transaction(async (tx) => {
          const [inserted] = await tx.insert(payments).values(payment).returning();
          if (!inserted) throw new Error('payment insert returned nothing');
          await tx
            .insert(ledgerItems)
            .values({ kind: 'payment', refId: inserted.id, itemHash: ledgerItemHash });
          return inserted;
        });
        return { row, created: true };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const existing = await forSeal(payment.sealId);
        if (!existing) throw err; // the tx hash was used for ANOTHER seal: never count it twice
        return { row: existing, created: false };
      }
    },
  };
}

export function createMemoryPaymentsRepo(): PaymentsRepo & { rows: PaymentRow[]; ledger: string[] } {
  const rows: PaymentRow[] = [];
  const ledger: string[] = [];
  return {
    rows,
    ledger,
    forSeal: async (sealId) => rows.find((r) => r.sealId === sealId) ?? null,
    async record(payment, hash) {
      const existing = rows.find((r) => r.sealId === payment.sealId);
      if (existing) return { row: existing, created: false };
      if (rows.some((r) => r.txHash === payment.txHash)) throw new Error('tx already used for another seal');
      const row = { ...payment, id: crypto.randomUUID() };
      rows.push(row);
      ledger.push(hash);
      return { row, created: true };
    },
  };
}
