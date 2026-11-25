/**
 * Line test: a short call from the "Cachet line test (demo)" agent (no seal, no money). Proves the
 * phone pipeline works and shows the caller ID Bolna uses, which must be registered for the AI caller.
 *
 *   pnpm voice:test +91XXXXXXXXXX       (trial accounts: a number verified in Bolna)
 */
import { LINE_TEST_AGENT, agentIdByName } from '@cachet/voice';
import { fail, loadRootEnv, stop } from './env';
import { bolnaFromEnv } from './voice-setup';

async function main(): Promise<void> {
  loadRootEnv();
  const to = process.argv[2] ?? '';
  if (!/^\+\d{8,15}$/.test(to)) fail('usage: pnpm voice:test +91XXXXXXXXXX');
  const bolna = bolnaFromEnv();
  const agentId = await agentIdByName(bolna, LINE_TEST_AGENT.name);
  if (!agentId) fail('Run "pnpm voice:setup" first.');

  const started = Date.now();
  const executionId = await bolna.startCall({ agentId, to, userData: {} });
  console.log(`Calling ${to.slice(0, 5)}… (execution ${executionId}). Pick up your phone.`);
  const end = await bolna.waitUntilOver(executionId, {
    onStatus: (e) => console.log(`  ${((Date.now() - started) / 1000).toFixed(1)} s  ${e.status}`),
  });
  // The call is over; the full record (caller ID, duration) can take a few seconds to fill in.
  await new Promise((r) => setTimeout(r, 8000));
  const full = await bolna.getExecution(executionId);
  console.log(`\nResult: ${full.status} (${full.terminationReason ?? end.terminationReason ?? '?'})`);
  console.log(`  duration:  ${full.durationSeconds ?? '?'} s, hung up by ${full.hangupBy ?? '?'}`);
  console.log(`  caller ID: ${full.fromNumber ?? 'not reported'}`);
  const tel = full.raw['telephony_data'];
  console.log(`  telephony fields: ${tel && typeof tel === 'object' ? Object.keys(tel).join(', ') : 'none'}`);
}

main().catch(stop);
