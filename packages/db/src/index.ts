import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema';

export * from './schema';
export { schema };
/** Query helpers, re-exported so apps use the same drizzle-orm copy as the schema. */
export { and, eq, sql } from 'drizzle-orm';

export type Db = NodePgDatabase<typeof schema>;

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

export interface DbHandle {
  db: Db;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

/** Connect to Postgres. Server-side only. */
export function createDb(url: string): DbHandle {
  const pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 });
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));
  const db = drizzle(pool, { schema });
  return {
    db,
    async ping() {
      try {
        await pool.query('select 1');
        return true;
      } catch {
        return false;
      }
    },
    close: () => pool.end(),
  };
}

/** Apply pending migrations (safe to run on every start; already-applied ones are skipped). */
export async function runMigrations(handle: DbHandle): Promise<void> {
  await migrate(handle.db, { migrationsFolder: MIGRATIONS });
}
