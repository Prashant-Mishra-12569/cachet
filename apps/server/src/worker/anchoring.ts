import type { TxSender } from '@cachet/concordium';
import { anchorPayload } from '@cachet/shared/seal';
import type { KvStore } from '../infra/kv';
import type { AnchorRepo, AnchorRow } from './anchor-repo';

export interface AnchorWorkerDeps {
  repo: AnchorRepo;
  sender: TxSender;
  kv: KvStore;
  /** Anchor when the oldest waiting item is this old (plan: 5 minutes)… */
  intervalSeconds: number;
  /** …or as soon as this many items wait (plan: 500). Also the batch size. */
  batchMax?: number;
  now?: () => number;
  log?: Pick<Console, 'log' | 'error'>;
}

export type TickResult =
  | { action: 'locked' | 'idle' | 'waiting' }
  | { action: 'anchored'; anchorId: number; txHash: string; items: number }
  | { action: 'failed'; anchorId: number; error: string };

const LOCK = 'anchor:lock';

/**
 * Anchors the ledger on chain: Merkle root of new seals / closings → RegisterData("CACHET1" || root).
 * One tick at a time across all servers (Redis lock). Safe to call often (e.g. every 30 s).
 */
export function createAnchorWorker(deps: AnchorWorkerDeps) {
  const batchMax = deps.batchMax ?? 500;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? console;

  /** Submit (if needed) and wait for finality; on failure release the items for the next batch. */
  async function finish(anchor: AnchorRow): Promise<TickResult> {
    let txHash = anchor.txHash;
    try {
      if (!txHash) {
        txHash = await deps.sender.registerData(anchorPayload(anchor.merkleRoot));
        await deps.repo.markSubmitted(anchor.id, txHash);
      }
      const outcome = await deps.sender.waitForFinal(txHash);
      const summary = outcome.summary as { transactionType?: string } | null;
      if (summary?.transactionType !== 'registerData') {
        throw new Error(`anchor transaction was rejected (${summary?.transactionType ?? 'unknown'})`);
      }
      await deps.repo.markFinalized(anchor.id, outcome.blockHash.toString());
      log.log(`[anchor] #${anchor.id}: ${anchor.itemCount} item(s) finalized in tx ${txHash}`);
      return { action: 'anchored', anchorId: anchor.id, txHash, items: anchor.itemCount };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error(`[anchor] #${anchor.id} failed, items released for the next batch: ${error}`);
      await deps.repo.markFailedAndRelease(anchor.id, error);
      return { action: 'failed', anchorId: anchor.id, error };
    }
  }

  async function tick(options: { force?: boolean } = {}): Promise<TickResult> {
    if (!(await deps.kv.claim(LOCK, 300))) return { action: 'locked' };
    try {
      // 1. Finish anything a previous run (or a crash) left behind.
      let recovered: TickResult | undefined;
      for (const anchor of await deps.repo.unfinished()) {
        recovered = await finish(anchor);
        if (recovered.action === 'failed') return recovered;
      }
      // 2. Anchor new items when the oldest waited long enough, or the batch is full.
      const { count, oldest } = await deps.repo.backlog();
      // Report a recovery instead of hiding it behind "idle"/"waiting".
      if (count === 0 || !oldest) return recovered ?? { action: 'idle' };
      const due = now() - oldest.getTime() >= deps.intervalSeconds * 1000;
      if (!options.force && !due && count < batchMax) return recovered ?? { action: 'waiting' };

      const batch = await deps.repo.claimBatch(batchMax);
      if (!batch) return { action: 'idle' };
      const anchor = (await deps.repo.unfinished()).find((a) => a.id === batch.anchorId);
      if (!anchor) throw new Error(`claimed anchor #${batch.anchorId} disappeared`);
      return await finish(anchor);
    } finally {
      await deps.kv.del(LOCK);
    }
  }

  return { tick };
}

export type AnchorWorker = ReturnType<typeof createAnchorWorker>;
