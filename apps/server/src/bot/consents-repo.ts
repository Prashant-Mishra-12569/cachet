import { randomBytes } from 'node:crypto';
import { and, consents, eq, ledgerItems, sql, type Db } from '@cachet/db';
import { canonicalize, sha256Hex } from '@cachet/shared/seal';

export type ConsentStatus = 'granted' | 'revoked';

export interface ConsentsRepo {
  statusFor(phoneHash: string, businessId: string): Promise<ConsentStatus | null>;
  /** Allow or block a company; recorded for the on-chain ledger (hash only, no phone data). */
  set(phoneHash: string, businessId: string, status: ConsentStatus, now: Date): Promise<void>;
}

export function createConsentsRepo(db: Db): ConsentsRepo {
  return {
    async statusFor(phoneHash, businessId) {
      const rows = await db
        .select({ status: consents.status })
        .from(consents)
        .where(and(eq(consents.phoneHash, phoneHash), eq(consents.businessId, businessId)))
        .limit(1);
      return rows[0]?.status ?? null;
    },
    async set(phoneHash, businessId, status, now) {
      await db.transaction(async (tx) => {
        const rows = await tx
          .insert(consents)
          .values({ phoneHash, businessId, status, source: 'bot', updatedAt: now })
          .onConflictDoUpdate({
            target: [consents.phoneHash, consents.businessId],
            set: { status, updatedAt: sql`now()` },
          })
          .returning({ id: consents.id });
        const id = rows[0]?.id;
        if (!id) throw new Error('consent upsert returned no id');
        // Random salt: two identical changes in the same millisecond still get different ledger hashes,
        // and nobody can guess a consent status from its public hash.
        const item = {
          v: 'cachet-consent/1',
          id,
          businessId,
          status,
          at: now.toISOString(),
          salt: randomBytes(16).toString('hex'),
        };
        await tx
          .insert(ledgerItems)
          .values({ kind: 'consent', refId: id, itemHash: sha256Hex(canonicalize(item)) });
      });
    },
  };
}

export function createMemoryConsentsRepo(): ConsentsRepo & { rows: Map<string, ConsentStatus> } {
  const rows = new Map<string, ConsentStatus>();
  return {
    rows,
    statusFor: async (p, b) => rows.get(`${p}|${b}`) ?? null,
    async set(p, b, status) {
      rows.set(`${p}|${b}`, status);
    },
  };
}
