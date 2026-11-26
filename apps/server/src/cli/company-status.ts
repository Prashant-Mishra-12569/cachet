/**
 * Cachet operator command: suspend or reinstate a company (written to the permanent record).
 *
 *   pnpm company:status <company account> suspended "Reason"
 *   pnpm company:status <company account> active "Reviewed: reports were mistaken"
 *
 * Uses DATABASE_URL (local by default; for the hosted one, set it to the Railway Postgres
 * DATABASE_PUBLIC_URL first). Suspending also ends the company's open seals; the bot's sweep then
 * ends their cards within 15 seconds. Its Web3 ID credential is revoked by the server's credential job.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb } from '@cachet/db';
import { canonicalize, sha256Hex } from '@cachet/shared/seal';
import { createBusinessRepo } from '../business/repo';
import { createSealRepo } from '../seals/repo';

const ROOT_ENV = fileURLToPath(new URL('../../../../.env', import.meta.url));

async function main() {
  if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);
  const [account, status, ...reasonParts] = process.argv.slice(2);
  const reason = reasonParts.join(' ').trim();
  if (!account || (status !== 'active' && status !== 'suspended') || reason.length < 3) {
    console.error('Usage: pnpm company:status <company account> active|suspended "Reason"');
    process.exitCode = 1;
    return;
  }
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set.');
  const handle = createDb(url);
  try {
    const repo = createBusinessRepo(handle.db);
    const business = await repo.findByAccount(account);
    if (!business) throw new Error('No verified company with that account.');
    if (business.status === status) {
      console.log(`${business.legalName} is already ${status}. Nothing changed.`);
      return;
    }
    const now = new Date();
    await repo.setStatus(business.id, status, reason, now);
    console.log(`✓ ${business.legalName} is now ${status} (written to the permanent record).`);
    if (status === 'suspended') {
      const seals = createSealRepo(handle.db);
      let ended = 0;
      for (const row of await seals.openForBusiness(business.id, now)) {
        const item = {
          v: 'cachet-seal-closed/1',
          sealId: row.id,
          closedAt: now.toISOString(),
          reason: 'company_suspended',
        };
        const closed = await seals.close(row.id, row.agentId, now, 'company_suspended', {
          kind: 'seal_closed',
          refId: row.id,
          itemHash: sha256Hex(canonicalize(item)),
        });
        if (closed) ended++;
      }
      console.log(`  Ended ${ended} open seal(s); their cards update within 15 seconds.`);
    }
  } finally {
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
