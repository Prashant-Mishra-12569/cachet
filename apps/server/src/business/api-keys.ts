import { createHash, randomBytes } from 'node:crypto';
import { and, apiKeys, desc, eq, isNull, sql, type Db } from '@cachet/db';

/**
 * Read-only API keys: a company's own systems pull its call data (GET /v1/data/*) without a browser.
 * - The key is shown ONCE; only its sha256 is stored, so a database leak gives nobody a working key.
 * - Read-only by construction: the routes behind these keys only read.
 * - Revoking works at once. At most 10 active keys per company.
 */
export const API_KEY_PREFIX = 'cachet_ro_';
export const MAX_ACTIVE_KEYS = 10;
const KEY_FORMAT = /^cachet_ro_[A-Za-z0-9_-]{43}$/;

export const hashApiKey = (key: string) => createHash('sha256').update(key, 'utf8').digest('hex');

export interface ApiKeyView {
  id: string;
  name: string;
  /** e.g. "cachet_ro_Ab3k" (enough to tell keys apart, useless to an attacker) */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ApiKeyRepo {
  create(row: { businessId: string; name: string; keyHash: string; prefix: string }): Promise<ApiKeyView>;
  listFor(businessId: string): Promise<ApiKeyView[]>;
  activeCount(businessId: string): Promise<number>;
  revoke(businessId: string, id: string, now: Date): Promise<boolean>;
  /** The active key with this hash → its company. */
  findActive(keyHash: string): Promise<{ id: string; businessId: string; lastUsedAt: Date | null } | null>;
  touch(id: string, now: Date): Promise<void>;
}

const view = (r: {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}): ApiKeyView => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  createdAt: r.createdAt.toISOString(),
  lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  revokedAt: r.revokedAt?.toISOString() ?? null,
});

export function createApiKeyRepo(db: Db): ApiKeyRepo {
  return {
    async create(row) {
      const [r] = await db.insert(apiKeys).values(row).returning();
      if (!r) throw new Error('api key insert returned no row');
      return view(r);
    },
    async listFor(businessId) {
      const rows = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.businessId, businessId))
        .orderBy(desc(apiKeys.createdAt));
      return rows.map(view);
    },
    async activeCount(businessId) {
      const [r] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(apiKeys)
        .where(and(eq(apiKeys.businessId, businessId), isNull(apiKeys.revokedAt)));
      return r?.n ?? 0;
    },
    async revoke(businessId, id, now) {
      const rows = await db
        .update(apiKeys)
        .set({ revokedAt: now })
        .where(and(eq(apiKeys.id, id), eq(apiKeys.businessId, businessId), isNull(apiKeys.revokedAt)))
        .returning({ id: apiKeys.id });
      return rows.length === 1;
    },
    async findActive(keyHash) {
      const [r] = await db
        .select({ id: apiKeys.id, businessId: apiKeys.businessId, lastUsedAt: apiKeys.lastUsedAt })
        .from(apiKeys)
        .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
        .limit(1);
      return r ?? null;
    },
    async touch(id, now) {
      await db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, id));
    },
  };
}

export function createMemoryApiKeyRepo(): ApiKeyRepo & { rows: Map<string, Record<string, unknown>> } {
  type Row = {
    id: string;
    businessId: string;
    name: string;
    keyHash: string;
    prefix: string;
    createdAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
  };
  const rows = new Map<string, Row>();
  return {
    rows: rows as unknown as Map<string, Record<string, unknown>>,
    async create(input) {
      const r: Row = {
        ...input,
        id: crypto.randomUUID(),
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
      };
      rows.set(r.id, r);
      return view(r);
    },
    listFor: async (b) => [...rows.values()].filter((r) => r.businessId === b).map(view),
    activeCount: async (b) => [...rows.values()].filter((r) => r.businessId === b && !r.revokedAt).length,
    async revoke(b, id, now) {
      const r = rows.get(id);
      if (!r || r.businessId !== b || r.revokedAt) return false;
      r.revokedAt = now;
      return true;
    },
    async findActive(hash) {
      const r = [...rows.values()].find((x) => x.keyHash === hash && !x.revokedAt);
      return r ? { id: r.id, businessId: r.businessId, lastUsedAt: r.lastUsedAt } : null;
    },
    async touch(id, now) {
      const r = rows.get(id);
      if (r) r.lastUsedAt = now;
    },
  };
}

export class ApiKeyError extends Error {
  constructor(readonly code: 'too_many_api_keys' | 'api_key_not_found') {
    super(code);
  }
}

export function createApiKeys(deps: { repo: ApiKeyRepo; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());
  return {
    /** Make a key. The full key is returned only here, never again. */
    async create(businessId: string, name: string): Promise<{ key: string; apiKey: ApiKeyView }> {
      if ((await deps.repo.activeCount(businessId)) >= MAX_ACTIVE_KEYS)
        throw new ApiKeyError('too_many_api_keys');
      const key = API_KEY_PREFIX + randomBytes(32).toString('base64url');
      const apiKey = await deps.repo.create({
        businessId,
        name,
        keyHash: hashApiKey(key),
        prefix: key.slice(0, API_KEY_PREFIX.length + 4),
      });
      return { key, apiKey };
    },
    list: (businessId: string) => deps.repo.listFor(businessId),
    async revoke(businessId: string, id: string) {
      if (!(await deps.repo.revoke(businessId, id, now()))) throw new ApiKeyError('api_key_not_found');
    },
    /** A presented key → its company, or null. Notes "last used" at most once a minute. */
    async verify(key: string): Promise<{ businessId: string } | null> {
      if (!KEY_FORMAT.test(key)) return null;
      const found = await deps.repo.findActive(hashApiKey(key));
      if (!found) return null;
      const t = now();
      if (!found.lastUsedAt || t.getTime() - found.lastUsedAt.getTime() > 60_000) {
        await deps.repo.touch(found.id, t);
      }
      return { businessId: found.businessId };
    },
  };
}

export type ApiKeys = ReturnType<typeof createApiKeys>;
