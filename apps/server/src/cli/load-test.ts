/**
 * Load test (plan Phase 7): N seals per second for D seconds against a RUNNING local server, signed
 * exactly like a real AI caller. Requests leave on a fixed clock (one every 1000/N ms) whether or not
 * earlier ones have answered, like real traffic. Reports p50 / p95 / p99 latency and errors.
 *
 *   pnpm load-test            (50 per second for 120 s)
 *   pnpm load-test 20 30      (20 per second for 30 s)
 *
 * LOCAL ONLY (refuses other hosts). Callees are fictional UK numbers reserved for drama (Ofcom), never
 * registered, so no card is sent to anyone. Each seal uses one credit.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { AccountAddress, signMessage } from '@concordium/web-sdk';
import { loadAccountKey } from '@cachet/concordium';
import { canonicalize, sealRequestMessage, sha256Hex } from '@cachet/shared/seal';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** Ofcom drama ranges: 1,000 numbers each, nobody owns them. */
const DRAMA = [
  '44113496',
  '44114496',
  '44115496',
  '44116496',
  '44117496',
  '44118496',
  '44121496',
  '44131496',
  '44151496',
  '44161496',
  '44191498',
  '44207946',
];
const dramaNumber = (i: number) =>
  `+${DRAMA[Math.floor(i / 1000) % DRAMA.length]}0${String(i % 1000).padStart(3, '0')}`;

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

async function main() {
  if (existsSync(`${ROOT}.env`)) process.loadEnvFile(`${ROOT}.env`);
  const [rateArg, secondsArg] = process.argv.slice(2);
  const rate = Number(rateArg ?? 50);
  const seconds = Number(secondsArg ?? 120);
  const api = (process.env['CACHET_API_URL'] ?? 'http://localhost:8787').replace(/\/+$/, '');
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(api))
    throw new Error('Load test runs ONLY against a local server.');
  const total = Math.round(rate * seconds);
  if (total > DRAMA.length * 1000) throw new Error(`At most ${DRAMA.length * 1000} seals per run.`);

  const key = await loadAccountKey({
    path: need('CCD_AGENT_KEY_PATH'),
    expectedAddress: need('CCD_AGENT_ADDRESS'),
    network: 'testnet',
    forbiddenDir: ROOT,
  });
  const badge = need('CACHET_AGENT_BADGE');
  const from = need('VOICE_CALLER_ID');
  const agentAccount = key.address.address;
  const address = AccountAddress.fromBase58(agentAccount);

  async function one(i: number) {
    const request = {
      v: 'cachet-seal-request/1',
      badge,
      agentAccount,
      to: dramaNumber(i),
      from,
      purpose: 'billing',
      message: 'Your energy bill is ready',
      nonce: randomBytes(16).toString('hex'),
      ts: Math.floor(Date.now() / 1000),
    };
    const signature = await signMessage(
      address,
      sealRequestMessage(sha256Hex(canonicalize(request))),
      key.signer,
    );
    const t0 = performance.now();
    try {
      const res = await fetch(`${api}/v1/seals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request, signature }),
      });
      const body = (await res.json()) as { error?: { code?: string } };
      return {
        ms: performance.now() - t0,
        ok: res.status === 201,
        code: body.error?.code ?? String(res.status),
      };
    } catch (err) {
      return { ms: performance.now() - t0, ok: false, code: err instanceof Error ? err.message : 'network' };
    }
  }

  console.log(`Sending ${rate} seals/s for ${seconds} s (${total} seals) to ${api} ...`);
  const started = performance.now();
  const pending: Promise<{ ms: number; ok: boolean; code: string }>[] = [];
  for (let i = 0; i < total; i++) {
    const due = started + (i * 1000) / rate;
    const wait = due - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    pending.push(one(i));
  }
  const results = await Promise.all(pending);
  const elapsed = (performance.now() - started) / 1000;

  const ok = results
    .filter((r) => r.ok)
    .map((r) => r.ms)
    .sort((a, b) => a - b);
  const pct = (p: number) => ok[Math.min(ok.length - 1, Math.floor((p / 100) * ok.length))] ?? NaN;
  const errors = new Map<string, number>();
  for (const r of results.filter((x) => !x.ok)) errors.set(r.code, (errors.get(r.code) ?? 0) + 1);
  console.log(
    `Done in ${elapsed.toFixed(1)} s: ${ok.length}/${total} sealed (${(ok.length / elapsed).toFixed(1)}/s)`,
  );
  console.log(
    `latency ms  p50 ${pct(50).toFixed(0)}  p95 ${pct(95).toFixed(0)}  p99 ${pct(99).toFixed(0)}  max ${(ok.at(-1) ?? NaN).toFixed(0)}`,
  );
  if (errors.size) console.log('errors:', Object.fromEntries(errors));
  const pass = ok.length === total && pct(95) < 800;
  console.log(pass ? '✓ PASS (all sealed, p95 < 800 ms)' : '✗ FAIL');
  if (!pass) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
