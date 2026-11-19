import { agents, and, arrayOverlaps, eq, ne, sql, type AgentPurpose, type Db } from '@cachet/db';

export type AgentStatus = 'draft' | 'registered' | 'active' | 'revoked';

export interface AgentRecord {
  id: string;
  businessId: string;
  name: string;
  description: string;
  purposes: AgentPurpose[];
  language: string;
  callingNumbers: string[];
  agentAccount: string;
  status: AgentStatus;
  tokenId: bigint | null;
  badge: string | null;
  registerTx: string | null;
  agentWallet: string | null;
  agentUri: string | null;
  metadataHash: string | null;
  cardJson: string | null;
  cardTx: string | null;
  createdAt: Date;
}

export interface NewAgentInput {
  businessId: string;
  name: string;
  description: string;
  purposes: AgentPurpose[];
  language: string;
  callingNumbers: string[];
  agentAccount: string;
}

export type AgentPatch = Partial<
  Pick<
    AgentRecord,
    | 'status'
    | 'tokenId'
    | 'badge'
    | 'registerTx'
    | 'agentWallet'
    | 'agentUri'
    | 'metadataHash'
    | 'cardJson'
    | 'cardTx'
  >
>;

/** Thrown when a unique column (token_id, register_tx, card_tx) is already taken. */
export class DuplicateError extends Error {
  constructor(readonly column: string) {
    super(`duplicate ${column}`);
    this.name = 'DuplicateError';
  }
}

export interface AgentRepo {
  listByBusiness(businessId: string): Promise<AgentRecord[]>;
  findForBusiness(businessId: string, agentId: string): Promise<AgentRecord | null>;
  /** By badge (base58 CIS-2 token address). */
  findByBadge(badge: string): Promise<AgentRecord | null>;
  findById(agentId: string): Promise<AgentRecord | null>;
  listActive(): Promise<AgentRecord[]>;
  create(input: NewAgentInput): Promise<AgentRecord>;
  /**
   * Apply `patch` only if the agent is still in `expectedStatus` (no double-processing when two
   * requests race). Returns the updated row, or null if the status had already changed.
   */
  transition(agentId: string, expectedStatus: AgentStatus, patch: AgentPatch): Promise<AgentRecord | null>;
  /** Which of these numbers are already used by another (non-revoked) agent? */
  numbersInUse(numbers: string[]): Promise<string[]>;
}

const asRecord = (row: typeof agents.$inferSelect): AgentRecord => ({
  ...row,
  purposes: row.purposes as AgentPurpose[],
});

function rethrowDuplicate(err: unknown): never {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const pg = e.code ? e : e.cause;
  if (pg?.code === '23505') throw new DuplicateError(pg.constraint ?? 'unique');
  throw err;
}

export function createAgentRepo(db: Db): AgentRepo {
  return {
    async listByBusiness(businessId) {
      const rows = await db
        .select()
        .from(agents)
        .where(eq(agents.businessId, businessId))
        .orderBy(agents.createdAt);
      return rows.map(asRecord);
    },
    async findForBusiness(businessId, agentId) {
      const rows = await db
        .select()
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.businessId, businessId)))
        .limit(1);
      return rows[0] ? asRecord(rows[0]) : null;
    },
    async findByBadge(badge) {
      const rows = await db.select().from(agents).where(eq(agents.badge, badge)).limit(1);
      return rows[0] ? asRecord(rows[0]) : null;
    },
    async findById(agentId) {
      const rows = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
      return rows[0] ? asRecord(rows[0]) : null;
    },
    async listActive() {
      const rows = await db.select().from(agents).where(eq(agents.status, 'active'));
      return rows.map(asRecord);
    },
    async create(input) {
      const rows = await db.insert(agents).values(input).returning();
      if (!rows[0]) throw new Error('insert returned no row');
      return asRecord(rows[0]);
    },
    async transition(agentId, expectedStatus, patch) {
      try {
        const rows = await db
          .update(agents)
          .set({ ...patch, updatedAt: sql`now()` })
          .where(and(eq(agents.id, agentId), eq(agents.status, expectedStatus)))
          .returning();
        return rows[0] ? asRecord(rows[0]) : null;
      } catch (err) {
        rethrowDuplicate(err);
      }
    },
    async numbersInUse(numbers) {
      if (numbers.length === 0) return [];
      const rows = await db
        .select({ numbers: agents.callingNumbers })
        .from(agents)
        .where(and(arrayOverlaps(agents.callingNumbers, numbers), ne(agents.status, 'revoked')));
      const used = new Set(rows.flatMap((r) => r.numbers));
      return numbers.filter((n) => used.has(n));
    },
  };
}

/** In-memory repo for tests (mirrors the unique constraints). */
export function createMemoryAgentRepo(): AgentRepo & { rows: Map<string, AgentRecord> } {
  const rows = new Map<string, AgentRecord>();
  const unique = ['tokenId', 'registerTx', 'cardTx'] as const;
  return {
    rows,
    listByBusiness: async (businessId) => [...rows.values()].filter((a) => a.businessId === businessId),
    findForBusiness: async (businessId, agentId) => {
      const a = rows.get(agentId);
      return a && a.businessId === businessId ? a : null;
    },
    findByBadge: async (badge) => [...rows.values()].find((a) => a.badge === badge) ?? null,
    findById: async (agentId) => rows.get(agentId) ?? null,
    listActive: async () => [...rows.values()].filter((a) => a.status === 'active'),
    async create(input) {
      const record: AgentRecord = {
        ...input,
        id: crypto.randomUUID(),
        status: 'draft',
        tokenId: null,
        badge: null,
        registerTx: null,
        agentWallet: null,
        agentUri: null,
        metadataHash: null,
        cardJson: null,
        cardTx: null,
        createdAt: new Date(),
      };
      rows.set(record.id, record);
      return record;
    },
    async transition(agentId, expectedStatus, patch) {
      const a = rows.get(agentId);
      if (!a || a.status !== expectedStatus) return null;
      for (const col of unique) {
        const value = patch[col];
        if (value != null && [...rows.values()].some((o) => o.id !== agentId && o[col] === value)) {
          throw new DuplicateError(col);
        }
      }
      const next = { ...a, ...patch };
      rows.set(agentId, next);
      return next;
    },
    async numbersInUse(numbers) {
      const used = new Set(
        [...rows.values()].filter((a) => a.status !== 'revoked').flatMap((a) => a.callingNumbers),
      );
      return numbers.filter((n) => used.has(n));
    },
  };
}
