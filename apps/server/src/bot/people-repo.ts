import { consents, eq, people, sql, type Db, type PersonRow } from '@cachet/db';

export type { PersonRow };

export interface NewPerson {
  tgUserId: number;
  chatId: number;
  phoneHash: string;
  phoneEnc: string;
  lang: string;
  /** The company whose invite link brought them (set only when they first join). */
  invitedByBusinessId?: string | null;
}

export interface PeopleRepo {
  byTelegramId(tgUserId: number): Promise<PersonRow | null>;
  byId(id: string): Promise<PersonRow | null>;
  byPhoneHash(phoneHash: string): Promise<PersonRow | null>;
  /**
   * Save a person. One row per Telegram user AND one per number: if this number was registered by
   * another Telegram account (numbers get recycled), that old registration is removed.
   */
  register(input: NewPerson): Promise<PersonRow>;
  /**
   * /stop: delete everything we hold about this Telegram user: the person (their reports and family
   * links go with it, by cascade) and their consent choices. True if something was deleted.
   */
  deleteByTelegramId(tgUserId: number): Promise<boolean>;
}

export function createPeopleRepo(db: Db): PeopleRepo {
  return {
    async byTelegramId(tgUserId) {
      const rows = await db.select().from(people).where(eq(people.tgUserId, tgUserId)).limit(1);
      return rows[0] ?? null;
    },
    async byId(id) {
      const rows = await db.select().from(people).where(eq(people.id, id)).limit(1);
      return rows[0] ?? null;
    },
    async byPhoneHash(phoneHash) {
      const rows = await db.select().from(people).where(eq(people.phoneHash, phoneHash)).limit(1);
      return rows[0] ?? null;
    },
    async register(input) {
      return db.transaction(async (tx) => {
        // The number moved to this Telegram account: drop the previous holder's registration.
        await tx
          .delete(people)
          .where(sql`${people.phoneHash} = ${input.phoneHash} and ${people.tgUserId} <> ${input.tgUserId}`);
        const rows = await tx
          .insert(people)
          .values(input)
          .onConflictDoUpdate({
            target: people.tgUserId,
            set: {
              chatId: input.chatId,
              phoneHash: input.phoneHash,
              phoneEnc: input.phoneEnc,
              lang: input.lang,
              updatedAt: sql`now()`,
            },
          })
          .returning();
        const row = rows[0];
        if (!row) throw new Error('person upsert returned no row');
        return row;
      });
    },
    async deleteByTelegramId(tgUserId) {
      return db.transaction(async (tx) => {
        const rows = await tx
          .delete(people)
          .where(eq(people.tgUserId, tgUserId))
          .returning({ phoneHash: people.phoneHash });
        const deleted = rows[0];
        if (!deleted) return false;
        await tx.delete(consents).where(eq(consents.phoneHash, deleted.phoneHash));
        return true;
      });
    },
  };
}

/** In-memory version for tests. */
export function createMemoryPeopleRepo(): PeopleRepo & { rows: Map<number, PersonRow> } {
  const rows = new Map<number, PersonRow>();
  return {
    rows,
    byTelegramId: async (id) => rows.get(id) ?? null,
    byPhoneHash: async (h) => [...rows.values()].find((p) => p.phoneHash === h) ?? null,
    byId: async (id) => [...rows.values()].find((p) => p.id === id) ?? null,
    async register(input) {
      for (const [id, p] of rows)
        if (p.phoneHash === input.phoneHash && id !== input.tgUserId) rows.delete(id);
      const existing = rows.get(input.tgUserId);
      const row: PersonRow = {
        id: existing?.id ?? crypto.randomUUID(),
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
        ...input,
        invitedByBusinessId: existing ? existing.invitedByBusinessId : (input.invitedByBusinessId ?? null),
      };
      rows.set(input.tgUserId, row);
      return row;
    },
    deleteByTelegramId: async (id) => rows.delete(id),
  };
}
