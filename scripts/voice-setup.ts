/**
 * Create (or update) Cachet's demo voice agents on Bolna from their definitions in @cachet/voice.
 * Safe to run again after changing a prompt. Needs VOICE_PROVIDER=bolna and VOICE_API_KEY in .env.
 *
 *   pnpm voice:setup
 */
import { LINE_TEST_AGENT, NORTHWIND_AGENT, SCAM_AGENT, createBolna, ensureAgent } from '@cachet/voice';
import { fail, loadRootEnv, stop } from './env';

export function bolnaFromEnv() {
  if (process.env['VOICE_PROVIDER'] !== 'bolna') fail('Set VOICE_PROVIDER=bolna in .env');
  const apiKey = process.env['VOICE_API_KEY']?.trim();
  if (!apiKey) fail('Set VOICE_API_KEY (your Bolna API key) in .env');
  return createBolna({ apiKey });
}

async function main(): Promise<void> {
  loadRootEnv();
  const bolna = bolnaFromEnv();
  const me = await bolna.me();
  console.log(`Bolna account: wallet ${me.wallet}, up to ${me.concurrency.max} calls at once`);
  for (const def of [LINE_TEST_AGENT, NORTHWIND_AGENT, SCAM_AGENT]) {
    const { id, created } = await ensureAgent(bolna, def);
    console.log(`✓ ${created ? 'created' : 'updated'}: ${def.name} (${id})`);
  }
}

if (process.argv[1]?.endsWith('voice-setup.ts')) main().catch(stop);
