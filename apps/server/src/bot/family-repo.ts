import { and, eq, guardians, isNull, people, sql, type Db, type GuardianRow } from '@cachet/db';

export type { GuardianRow };

/** A confirmed guardian ↔ ward link, as the bot needs it. */
export interface FamilyLink {
  id: string;
  guardianPersonId: string;
  guardianName: string;
  guardianChatId: number;
  wardPersonId: string;
  wardLabel: string;
  wardChatId: number;
}

export interface FamilyRepo {
  /** Links (pending + confirmed) a guardian has, to enforce a limit. */
  countForGuardian(guardianPersonId: string): Promise<number>;
  createInvite(input: {
    guardianPersonId: string;
    guardianName: string;
    wardLabel: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<{ id: string }>;
  /** A still-open, unexpired invite by its token hash. */
  openInvite(tokenHash: string, now: Date): Promise<GuardianRow | null>;
  /**
   * The ward agrees. Single use: only works while the invite is open and unexpired.
   * 'linked' = done; 'already' = this guardian already protects this ward; 'gone' = used/expired.
   */
  accept(inviteId: string, wardPersonId: string, now: Date): Promise<'linked' | 'already' | 'gone'>;
  deleteInvite(inviteId: string): Promise<void>;
  /** Confirmed links where this person is the guardian or the ward. */
  linksOf(personId: string): Promise<FamilyLink[]>;
  /** Remove a confirmed link this person is part of. Returns it (to tell the other side), or null. */
  remove(linkId: string, personId: string): Promise<FamilyLink | null>;
}

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e.code ?? e.cause?.code) === '23505';
};

export function createFamilyRepo(db: Db): FamilyRepo {
  async function linksWhere(condition: ReturnType<typeof sql>): Promise<FamilyLink[]> {
    const rows = await db.execute(sql`
      select g.id, g.guardian_person_id, g.guardian_name, gp.chat_id as guardian_chat_id,
             g.ward_person_id, g.ward_label, wp.chat_id as ward_chat_id
      from ${guardians} g
      join ${people} gp on gp.id = g.guardian_person_id
      join ${people} wp on wp.id = g.ward_person_id
      where g.accepted_at is not null and ${condition}
      order by g.created_at`);
    return (rows.rows as Record<string, unknown>[]).map((r) => ({
      id: String(r['id']),
      guardianPersonId: String(r['guardian_person_id']),
      guardianName: String(r['guardian_name']),
      guardianChatId: Number(r['guardian_chat_id']),
      wardPersonId: String(r['ward_person_id']),
      wardLabel: String(r['ward_label']),
      wardChatId: Number(r['ward_chat_id']),
    }));
  }

  return {
    async countForGuardian(id) {
      const rows = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(guardians)
        .where(eq(guardians.guardianPersonId, id));
      return rows[0]?.n ?? 0;
    },
    async createInvite(input) {
      const rows = await db
        .insert(guardians)
        .values({
          guardianPersonId: input.guardianPersonId,
          guardianName: input.guardianName,
          wardLabel: input.wardLabel,
          inviteTokenHash: input.tokenHash,
          inviteExpiresAt: input.expiresAt,
        })
        .returning({ id: guardians.id });
      const id = rows[0]?.id;
      if (!id) throw new Error('invite insert returned no id');
      return { id };
    },
    async openInvite(tokenHash, now) {
      const rows = await db
        .select()
        .from(guardians)
        .where(
          and(
            eq(guardians.inviteTokenHash, tokenHash),
            isNull(guardians.wardPersonId),
            sql`${guardians.inviteExpiresAt} > ${now}`,
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async accept(inviteId, wardPersonId, now) {
      try {
        const rows = await db
          .update(guardians)
          .set({ wardPersonId, acceptedAt: now, inviteTokenHash: null, inviteExpiresAt: null })
          .where(
            and(
              eq(guardians.id, inviteId),
              isNull(guardians.wardPersonId),
              sql`${guardians.inviteExpiresAt} > ${now}`,
            ),
          )
          .returning({ id: guardians.id });
        return rows.length > 0 ? 'linked' : 'gone';
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        await db.delete(guardians).where(eq(guardians.id, inviteId));
        return 'already';
      }
    },
    async deleteInvite(inviteId) {
      await db.delete(guardians).where(and(eq(guardians.id, inviteId), isNull(guardians.wardPersonId)));
    },
    linksOf: (personId) =>
      linksWhere(sql`(g.guardian_person_id = ${personId} or g.ward_person_id = ${personId})`),
    async remove(linkId, personId) {
      const [link] = await linksWhere(
        sql`g.id = ${linkId} and (g.guardian_person_id = ${personId} or g.ward_person_id = ${personId})`,
      );
      if (!link) return null;
      await db.delete(guardians).where(eq(guardians.id, linkId));
      return link;
    },
  };
}

/** In-memory version for tests (same rules: single use, expiry, one link per pair). */
export function createMemoryFamilyRepo(lookup: (personId: string) => Promise<{ chatId: number } | null>) {
  const rows = new Map<string, GuardianRow>();
  async function toLink(g: GuardianRow): Promise<FamilyLink | null> {
    if (!g.wardPersonId || !g.acceptedAt) return null;
    const gp = await lookup(g.guardianPersonId);
    const wp = await lookup(g.wardPersonId);
    if (!gp || !wp) return null;
    return {
      id: g.id,
      guardianPersonId: g.guardianPersonId,
      guardianName: g.guardianName,
      guardianChatId: gp.chatId,
      wardPersonId: g.wardPersonId,
      wardLabel: g.wardLabel,
      wardChatId: wp.chatId,
    };
  }
  const repo: FamilyRepo & { rows: typeof rows } = {
    rows,
    countForGuardian: async (id) => [...rows.values()].filter((g) => g.guardianPersonId === id).length,
    async createInvite(input) {
      const id = crypto.randomUUID();
      rows.set(id, {
        id,
        guardianPersonId: input.guardianPersonId,
        guardianName: input.guardianName,
        wardLabel: input.wardLabel,
        wardPersonId: null,
        inviteTokenHash: input.tokenHash,
        inviteExpiresAt: input.expiresAt,
        acceptedAt: null,
        createdAt: new Date(),
      });
      return { id };
    },
    openInvite: async (hash, now) =>
      [...rows.values()].find(
        (g) =>
          g.inviteTokenHash === hash &&
          !g.wardPersonId &&
          g.inviteExpiresAt !== null &&
          g.inviteExpiresAt > now,
      ) ?? null,
    async accept(inviteId, wardPersonId, now) {
      const g = rows.get(inviteId);
      if (!g || g.wardPersonId || !g.inviteExpiresAt || g.inviteExpiresAt <= now) return 'gone';
      const dup = [...rows.values()].some(
        (o) => o.guardianPersonId === g.guardianPersonId && o.wardPersonId === wardPersonId,
      );
      if (dup) {
        rows.delete(inviteId);
        return 'already';
      }
      rows.set(inviteId, {
        ...g,
        wardPersonId,
        acceptedAt: now,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      });
      return 'linked';
    },
    async deleteInvite(id) {
      if (!rows.get(id)?.wardPersonId) rows.delete(id);
    },
    async linksOf(personId) {
      const out: FamilyLink[] = [];
      for (const g of rows.values()) {
        if (g.guardianPersonId !== personId && g.wardPersonId !== personId) continue;
        const link = await toLink(g);
        if (link) out.push(link);
      }
      return out;
    },
    async remove(linkId, personId) {
      const g = rows.get(linkId);
      if (!g || (g.guardianPersonId !== personId && g.wardPersonId !== personId)) return null;
      const link = await toLink(g);
      if (!link) return null;
      rows.delete(linkId);
      return link;
    },
  };
  return repo;
}
