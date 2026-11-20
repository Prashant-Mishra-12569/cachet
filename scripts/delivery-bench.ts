/**
 * Phase 3 checkmark: "a seal card arrives in < 2 s after the seal is issued (p95 over 50 runs)".
 * Against a RUNNING server (pnpm dev) with the bot connected, on testnet:
 *   issue a real signed seal → wait until the bot has delivered the card to Telegram → close the seal.
 * Timing is measured by the server itself: from the seal's creation (its ULID millisecond time) to
 * Telegram accepting the card (stored with the card in Redis as `deliveredMs`).
 * Afterwards the test cards are deleted from the chat (unless --keep-cards).
 * Spends one seal credit per run.
 *
 *   pnpm delivery:bench <badge> <calleeE164> [runs=50] [--keep-cards]
 */
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createClient } from 'redis';
import { signMessage } from '@concordium/web-sdk';
import { loadAccountKey } from '@cachet/concordium';
import { canonicalize, sealCloseMessage, sealRequestMessage, sha256Hex } from '@cachet/shared/seal';
import { fail, loadRootEnv, network, stop } from './env';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Telegram allows about one message per second per chat; each run sends one card and one edit. */
const GAP_MS = 2500;
const WAIT_MS = 10_000;

interface CardRef {
  sealId: string;
  chatId: number;
  messageId: number;
  deliveredMs?: number;
}

async function main(): Promise<void> {
  loadRootEnv();
  const args = process.argv.slice(2);
  const keepCards = args.includes('--keep-cards');
  const [badge, to, runsArg = '50'] = args.filter((a) => !a.startsWith('--'));
  const runs = Number(runsArg);
  if (!badge || !to || !Number.isInteger(runs) || runs < 1 || runs > 200)
    fail('usage: pnpm delivery:bench <badge> <calleeE164> [runs=50] [--keep-cards]');
  const api = `http://localhost:${process.env['PORT'] ?? '8787'}`;
  const path = process.env['CCD_AGENT_KEY_PATH'];
  const account = process.env['CCD_AGENT_ADDRESS'];
  const botToken = process.env['TELEGRAM_BOT_TOKEN'];
  if (!path || !account) fail('CCD_AGENT_KEY_PATH and CCD_AGENT_ADDRESS must be set in .env');
  if (!botToken) fail('TELEGRAM_BOT_TOKEN must be set in .env (the bot delivers the cards)');
  const key = await loadAccountKey({
    path,
    expectedAddress: account,
    network: network(),
    forbiddenDir: REPO_ROOT,
  });

  const health = await fetch(`${api}/healthz`).catch(() => null);
  if (!health?.ok) fail(`the server is not running at ${api}. Start it with: pnpm dev`);

  const redis = createClient({ url: process.env['REDIS_URL'] ?? 'redis://localhost:6379' });
  redis.on('error', () => undefined);
  await redis.connect();

  const signed = async (request: Record<string, unknown>, message: (d: string) => string) => ({
    request,
    signature: await signMessage(key.address, message(sha256Hex(canonicalize(request))), key.signer),
  });
  const post = async (route: string, body: unknown) => {
    const res = await fetch(`${api}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { res, json: (await res.json()) as Record<string, unknown> };
  };
  const nowS = () => Math.floor(Date.now() / 1000);

  const delivered: number[] = [];
  const cards: CardRef[] = [];
  let missed = 0;
  try {
    console.log(
      `Sending ${runs} test seals to ${to.slice(0, 4)}… (about ${Math.ceil((runs * GAP_MS) / 60_000)} min)\n`,
    );
    for (let i = 1; i <= runs; i++) {
      const issued = await post(
        '/v1/seals',
        await signed(
          {
            v: 'cachet-seal-request/1',
            badge,
            agentAccount: account,
            to,
            from: to,
            purpose: 'billing',
            message: 'Cachet delivery speed test',
            nonce: randomBytes(16).toString('hex'),
            ts: nowS(),
          },
          sealRequestMessage,
        ),
      );
      if (issued.res.status !== 201) {
        const code = (issued.json['error'] as { code?: string } | undefined)?.code;
        fail(
          `run ${i}: seal refused (HTTP ${issued.res.status}, ${code ?? 'unknown'})` +
            (code === 'payment_required' ? '\n  The agent has no seal credits left.' : '') +
            (code === 'consent_revoked' ? '\n  This number blocked the company: /consent → Allow.' : ''),
        );
      }
      const sealId = String(issued.json['sealId']);

      // Wait for the bot to record the delivered card.
      let ref: CardRef | null = null;
      const until = Date.now() + WAIT_MS;
      while (Date.now() < until) {
        const raw = await redis.get(`bot:card:${sealId}`);
        if (raw) {
          ref = JSON.parse(raw) as CardRef;
          break;
        }
        await sleep(25);
      }
      if (ref?.deliveredMs !== undefined) {
        delivered.push(ref.deliveredMs);
        cards.push(ref);
        console.log(`  ${String(i).padStart(2)}  card delivered in ${ref.deliveredMs} ms`);
      } else {
        missed++;
        console.log(`  ${String(i).padStart(2)}  ✗ no card within ${WAIT_MS / 1000} s`);
      }

      await post(
        `/v1/seals/${sealId}/close`,
        await signed(
          {
            v: 'cachet-seal-close/1',
            sealId,
            agentAccount: account,
            reason: 'completed',
            nonce: randomBytes(16).toString('hex'),
            ts: nowS(),
          },
          sealCloseMessage,
        ),
      );
      if (i < runs) await sleep(GAP_MS);
    }
  } finally {
    await redis.quit().catch(() => undefined);
  }

  const sorted = [...delivered].sort((a, b) => a - b);
  // Nearest-rank percentile over ALL runs: a missing card counts as slower than every delivered one.
  const pct = (p: number) => {
    const rank = Math.ceil((p / 100) * runs);
    return rank <= sorted.length ? (sorted[rank - 1] ?? Infinity) : Infinity;
  };
  const p95 = pct(95);
  console.log(`\nRuns: ${runs} · delivered: ${delivered.length} · missed: ${missed}`);
  console.log(`p50 ${pct(50)} ms · p95 ${p95} ms · max ${sorted.at(-1) ?? '-'} ms (target: p95 < 2000 ms)`);

  if (!keepCards && cards.length > 0) {
    await sleep(1500); // let the last "Call ended" edit land first
    let removed = 0;
    for (const c of cards) {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: c.chatId, message_id: c.messageId }),
      }).catch(() => null);
      if (res?.ok) removed++;
      await sleep(80);
    }
    console.log(`Cleaned up: deleted ${removed} of ${cards.length} test cards from the chat.`);
  }

  if (missed > 0 || !(p95 < 2000)) fail('delivery target NOT met');
  console.log('✓ delivery target met');
}

main().catch(stop);
