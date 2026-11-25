/**
 * Copy the local Cachet database into the hosted one (Railway), ONCE, before the hosted server
 * starts. Keeps everything already proven and registered on chain (company proof, AI caller,
 * people, seals, credits) instead of redoing it.
 *
 *   PowerShell:  $env:TARGET_DATABASE_URL = "<Railway Postgres DATABASE_PUBLIC_URL>"
 *                pnpm db:copy
 *
 * Runs pg_dump | psql inside ONE Linux container (no Windows text re-encoding in between).
 * --clean --if-exists: the target's Cachet tables are replaced by the local copy.
 * The URL is read from the environment and never printed.
 */
import { spawnSync } from 'node:child_process';

export const COPY_PIPELINE =
  "set -o pipefail; pg_dump $SRC --clean --if-exists --no-owner --no-privileges | sed '/^SET transaction_timeout/d' | psql $DST -v ON_ERROR_STOP=1 -q";

const target = process.env.TARGET_DATABASE_URL?.trim();
if (!target || !/^postgres(ql)?:\/\//.test(target)) {
  console.error(
    'Set TARGET_DATABASE_URL to the Railway Postgres DATABASE_PUBLIC_URL first (see the comment at the top).',
  );
  process.exit(1);
}
if (/localhost|127\.0\.0\.1|host\.docker\.internal/.test(target)) {
  console.error('TARGET_DATABASE_URL points at this computer. It must be the hosted database.');
  process.exit(1);
}

const source = 'postgres://cachet:cachet@host.docker.internal:5432/cachet';
console.log('Copying the local database to the hosted one…');
const run = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '-e',
    `SRC=${source}`,
    '-e',
    'DST',
    'postgres:18-alpine',
    'sh',
    '-c',
    // transaction_timeout only exists in Postgres 17+: drop it so an older hosted Postgres accepts the dump.
    // No double quotes inside: Windows argument passing must not be able to mangle this line.
    COPY_PIPELINE,
  ],
  { stdio: 'inherit', env: { ...process.env, DST: target } },
);
if (run.status !== 0) {
  console.error('\n✗ Copy failed (nothing above was printed with your URL). Check the URL and try again.');
  process.exitCode = 1;
} else {
  console.log('✓ Copied. Now deploy (or restart) the Cachet server on Railway.');
}
