/**
 * `pnpm dev` pre-check and `pnpm dev:stop`.
 *
 *   node scripts/dev-ports.mjs check   → fail with a clear message if Cachet is already running
 *   node scripts/dev-ports.mjs stop    → stop whatever listens on Cachet's dev ports
 *
 * Plain Node (no dependencies) so it runs before anything is built.
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';

const PORTS = [
  { port: 3000, name: 'website' },
  { port: 8787, name: 'server + bot' },
];

/** True if nothing is listening on the port. */
function isFree(port) {
  return new Promise((resolve) => {
    const srv = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => srv.close(() => resolve(true)))
      .listen(port);
  });
}

/** PIDs listening on a port (Windows: PowerShell; macOS/Linux: lsof). */
function listeners(port) {
  try {
    const out =
      process.platform === 'win32'
        ? execFileSync(
            'powershell',
            [
              '-NoProfile',
              '-Command',
              `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
            ],
            { encoding: 'utf8' },
          )
        : execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    return [
      ...new Set(
        out
          .split(/\s+/)
          .filter((s) => /^\d+$/.test(s))
          .map(Number),
      ),
    ].filter((pid) => pid > 0);
  } catch {
    return [];
  }
}

/** Stop a process and its children. */
function stopTree(pid) {
  try {
    if (process.platform === 'win32')
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

const mode = process.argv[2];

if (mode === 'check') {
  const busy = [];
  for (const p of PORTS) if (!(await isFree(p.port))) busy.push(p);
  if (busy.length > 0) {
    console.error(
      `\n✗ Cachet already seems to be running (${busy.map((b) => `port ${b.port}: ${b.name}`).join(', ')}).` +
        '\n  Use the terminal where it runs, or stop it with:  pnpm dev:stop\n',
    );
    process.exitCode = 1;
  }
} else if (mode === 'stop') {
  let stopped = 0;
  for (const p of PORTS) {
    for (const pid of listeners(p.port)) {
      if (stopTree(pid)) {
        stopped++;
        console.log(`✓ stopped the ${p.name} (port ${p.port}, process ${pid})`);
      }
    }
  }
  if (stopped === 0) console.log("Nothing was running on Cachet's dev ports.");
} else {
  console.error('usage: node scripts/dev-ports.mjs check|stop');
  process.exitCode = 1;
}
