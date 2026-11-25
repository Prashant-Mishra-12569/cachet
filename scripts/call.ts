/**
 * The demo AI caller (Northwind Energy, a DEMO company), end to end on testnet + a real phone:
 *   1. ask Cachet for a seal (prepaid with x402 credits; pays €0.01 itself if none are left),
 *   2. Bolna dials the person; the AI's first sentence is the seal's firstLine (AI disclosure + code),
 *   3. when the call is over (answered, no answer, busy, failed…) the seal is closed.
 * The person's Telegram card shows the same code the voice says, and turns "Call ended" afterwards.
 *
 *   pnpm call +91XXXXXXXXXX [--amount 12.40] [--message "Your November bill is ready"]
 *   pnpm call +91XXXXXXXXXX --scam      (scam scene: a caller WITHOUT a seal → no card, /check red)
 *
 * .env: VOICE_PROVIDER=bolna, VOICE_API_KEY, VOICE_CALLER_ID (the number Bolna calls from, registered
 * for the AI caller), CACHET_AGENT_BADGE, CCD_AGENT_KEY_PATH, CCD_AGENT_ADDRESS.
 */
import { createCachetClient, type CloseReason } from '@cachet/sdk';
import {
  NORTHWIND_AGENT,
  UNVERIFIED_AGENT,
  agentIdByName,
  closeReasonFor,
  type Execution,
} from '@cachet/voice';
import { fail, loadRootEnv, stop } from './env';
import { bolnaFromEnv } from './voice-setup';
import { agentPayingFetch } from './x402-client';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const since = (t: number) => `${((Date.now() - t) / 1000).toFixed(1)} s`;

async function main(): Promise<void> {
  loadRootEnv();
  const to = process.argv[2] ?? '';
  if (!/^\+\d{8,15}$/.test(to)) fail('usage: pnpm call +91XXXXXXXXXX [--amount 12.40] [--scam]');
  const bolna = bolnaFromEnv();
  const started = Date.now();
  const log = (e: Execution) => console.log(`  ${since(started).padStart(7)}  call: ${e.status}`);

  if (process.argv.includes('--scam')) {
    const scamId = await agentIdByName(bolna, UNVERIFIED_AGENT.name);
    if (!scamId) fail('Run "pnpm voice:setup" first.');
    console.log('SCAM SCENE (demo): "Saffron Trust Bank" (fictional) calls WITHOUT a Cachet seal.');
    console.log('  Never say a real code on this call: the AI stops and reveals the demo if you do.');
    console.log('  → No green card will arrive. Ask the bot /check during the call: it says NOT verified.\n');
    const id = await bolna.startCall({ agentId: scamId, to, userData: {} });
    const end = await bolna.waitUntilOver(id, { onStatus: log });
    console.log(`\nUnsealed call over: ${end.status}. No seal was ever issued for it.`);
    return;
  }

  const callerId = process.env['VOICE_CALLER_ID']?.trim() ?? '';
  const badge = process.env['CACHET_AGENT_BADGE']?.trim() ?? '';
  if (!/^\+\d{8,15}$/.test(callerId)) fail('Set VOICE_CALLER_ID in .env (the number Bolna calls from).');
  if (!badge) fail("Set CACHET_AGENT_BADGE in .env (the AI caller's Verified-by-Concordium badge).");
  const agentId = await agentIdByName(bolna, NORTHWIND_AGENT.name);
  if (!agentId) fail('Run "pnpm voice:setup" first.');

  // The agent's key is loaded and checked against CCD_AGENT_ADDRESS inside agentPayingFetch.
  const { fetch: payingFetch, signer, token } = await agentPayingFetch();
  const cachet = createCachetClient({
    baseUrl: `http://localhost:${process.env['PORT'] ?? '8787'}`,
    badge,
    account: process.env['CCD_AGENT_ADDRESS'] ?? '',
    signer,
    fetch: payingFetch,
  });
  const amountValue = flag('amount');
  const message = flag('message') ?? 'Your November bill is ready';

  // 1. The seal, right before dialling.
  const seal = await cachet.sealCall({
    to,
    from: callerId,
    purpose: 'billing',
    message,
    ...(amountValue ? { amount: { value: amountValue, asset: token } } : {}),
  });
  console.log(`✓ ${since(started)}  sealed: code ${seal.code} (credits left ${seal.creditsLeft})`);
  if (seal.x402Tx) console.log(`    paid on the spot with x402: ${seal.x402Tx}`);
  console.log(`    the AI will say: "${seal.firstLine}"`);

  let closed = false;
  async function close(reason: CloseReason) {
    if (closed) return;
    closed = true;
    try {
      await cachet.closeSeal(seal.sealId, reason);
      console.log(`✓ ${since(started)}  seal closed (${reason}) → the card now says the call ended`);
    } catch (err) {
      console.error(`✗ could not close the seal: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  process.once('SIGINT', () => {
    console.log('\nStopping: closing the seal first…');
    void close('cancelled').finally(() => {
      process.exitCode = 130;
      setTimeout(() => process.exit(130), 1500).unref();
    });
  });

  // 2. Dial. If Bolna refuses, the seal must not stay open (no green card for a call that never happens).
  let executionId: string;
  try {
    executionId = await bolna.startCall({
      agentId,
      to,
      userData: {
        first_line: seal.firstLine,
        company: seal.company,
        code_spoken: seal.spokenCode,
        message,
        amount_text: amountValue ? `€${amountValue} (test euro)` : 'nothing to pay on this call',
      },
    });
  } catch (err) {
    await close('failed');
    throw err;
  }
  console.log(`✓ ${since(started)}  dialling ${to.slice(0, 5)}… (Bolna execution ${executionId})`);

  // 3. Wait for the end of the call, then close the seal with the right reason.
  let end: Execution;
  try {
    end = await bolna.waitUntilOver(executionId, { onStatus: log });
  } catch (err) {
    await close('failed');
    throw err;
  }
  await close(closeReasonFor(end));

  // Honest caller ID: the number the person saw must be the one the seal promised.
  // Bolna fills in the final record (duration, caller ID) a little after the line drops: wait for it.
  let full = await bolna.getExecution(executionId);
  for (let i = 0; i < 15 && (full.status === 'call-disconnected' || !full.fromNumber); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    full = await bolna.getExecution(executionId);
  }
  console.log(`\nCall: ${full.status} (${full.terminationReason ?? '?'}), ${full.durationSeconds ?? '?'} s`);
  if (full.fromNumber && full.fromNumber !== callerId) {
    console.warn(
      `⚠ CALLER ID MISMATCH: the person saw ${full.fromNumber}, but the seal said ${callerId}.` +
        '\n  Register the real number for the AI caller (dashboard → "Calls come from") and update VOICE_CALLER_ID.',
    );
    process.exitCode = 1;
  } else if (full.fromNumber) {
    console.log(`✓ caller ID matches the seal: ${full.fromNumber}`);
  }
  console.log(`Public seal page: ${seal.verifyUrl}`);
}

main().catch(stop);
