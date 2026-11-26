import type { KvStore } from '../infra/kv';
import { errText } from '../infra/err-text';

/**
 * Watches the sponsor account (it pays the fees for safe payments, x402 settlements and on-chain
 * records). When its CCD falls below the limit: /healthz says "sponsor": "down", the log warns, and
 * the operator gets one Telegram message every 6 hours until it is topped up.
 */
export interface SponsorWatchDeps {
  /** The sponsor's CCD balance right now. */
  balance: () => Promise<number>;
  address: string;
  lowCcd: number;
  kv: Pick<KvStore, 'claim'>;
  /** Tell the operator (Telegram). Absent = log only. */
  notify?: ((text: string) => Promise<void>) | undefined;
  log?: Pick<Console, 'warn' | 'error'>;
}

export function createSponsorWatch(deps: SponsorWatchDeps) {
  const log = deps.log ?? console;
  let state: 'ok' | 'low' | 'unknown' = 'unknown';
  let lastCcd: number | null = null;

  return {
    async tick() {
      try {
        lastCcd = await deps.balance();
      } catch (err) {
        log.error('[sponsor] balance check failed:', errText(err));
        return state; // keep the last known state; one failed read is not an alarm
      }
      state = lastCcd < deps.lowCcd ? 'low' : 'ok';
      if (state === 'low') {
        const text = `⚠️ Cachet sponsor is low: ${lastCcd.toFixed(2)} CCD left (alert below ${deps.lowCcd}). Safe payments and on-chain records stop when it runs out. Top up ${deps.address}`;
        log.warn(`[sponsor] ${text}`);
        if (deps.notify && (await deps.kv.claim('sponsor:low-alert', 6 * 60 * 60))) {
          await deps.notify(text).catch((err: unknown) => log.error('[sponsor] alert failed:', errText(err)));
        }
      }
      return state;
    },
    /** For /healthz: false only when we KNOW it is low. */
    healthy: () => state !== 'low',
    get state() {
      return { state, ccd: lastCcd };
    },
  };
}
