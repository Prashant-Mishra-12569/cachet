import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { BlockItemSummaryInBlock } from '@concordium/web-sdk';
import type { TxSender } from '@cachet/concordium';
import { buildMerkleTree, parseAnchorPayload, verifyMerkleProof } from '@cachet/shared/seal';
import { createMemoryKv } from '../infra/kv';
import type { AnchorRepo, AnchorRow } from './anchor-repo';
import { createAnchorWorker } from './anchoring';

/** In-memory AnchorRepo with the same rules as the Postgres one. */
function memoryAnchorRepo() {
  const items: {
    id: number;
    itemHash: string;
    createdAt: Date;
    anchorId: number | null;
    leafIndex: number | null;
  }[] = [];
  const anchors: AnchorRow[] = [];
  let nextItem = 1;
  let nextAnchor = 1;
  const repo: AnchorRepo = {
    async backlog() {
      const waiting = items.filter((i) => i.anchorId === null);
      return { count: waiting.length, oldest: waiting[0]?.createdAt ?? null };
    },
    async claimBatch(limit) {
      const take = items.filter((i) => i.anchorId === null).slice(0, limit);
      if (take.length === 0) return null;
      const root = buildMerkleTree(take.map((i) => i.itemHash)).root;
      const anchor: AnchorRow = {
        id: nextAnchor++,
        merkleRoot: root,
        itemCount: take.length,
        status: 'pending',
        txHash: null,
        blockHash: null,
        error: null,
        createdAt: new Date(),
        finalizedAt: null,
      };
      anchors.push(anchor);
      take.forEach((i, idx) => Object.assign(i, { anchorId: anchor.id, leafIndex: idx }));
      return { anchorId: anchor.id, root, itemCount: take.length };
    },
    unfinished: async () => anchors.filter((a) => a.status === 'pending' || a.status === 'submitted'),
    async markSubmitted(id, txHash) {
      Object.assign(anchors.find((a) => a.id === id) ?? {}, { status: 'submitted', txHash });
    },
    async markFinalized(id, blockHash) {
      Object.assign(anchors.find((a) => a.id === id) ?? {}, { status: 'finalized', blockHash });
    },
    async markFailedAndRelease(id, error) {
      Object.assign(anchors.find((a) => a.id === id) ?? {}, { status: 'failed', error });
      items
        .filter((i) => i.anchorId === id)
        .forEach((i) => Object.assign(i, { anchorId: null, leafIndex: null }));
    },
    async inclusion() {
      return null;
    },
  };
  const add = (n: number, createdAt: Date) => {
    for (let k = 0; k < n; k++)
      items.push({
        id: nextItem++,
        itemHash: randomBytes(32).toString('hex'),
        createdAt,
        anchorId: null,
        leafIndex: null,
      });
  };
  return { repo, items, anchors, add };
}

/** Fake chain sender: records payloads; can be told to fail or reject. */
function fakeSender(mode: { submit?: 'ok' | 'throw'; outcome?: 'registerData' | 'failed' } = {}) {
  const sent: Uint8Array[] = [];
  const sender: TxSender = {
    address: 'sponsor',
    async registerData(data) {
      if (mode.submit === 'throw') throw new Error('insufficient CCD');
      sent.push(data);
      return 'a'.repeat(63) + String(sent.length);
    },
    async waitForFinal() {
      return {
        blockHash: { toString: () => 'b'.repeat(64) },
        summary: { transactionType: mode.outcome ?? 'registerData' },
      } as unknown as BlockItemSummaryInBlock;
    },
  };
  return { sender, sent, mode };
}

const quiet = { log: () => undefined, error: () => undefined };

function setup(mode?: Parameters<typeof fakeSender>[0]) {
  const clock = { t: Date.parse('2026-11-19T12:00:00Z') };
  const mem = memoryAnchorRepo();
  const chain = fakeSender(mode);
  const kv = createMemoryKv(() => clock.t);
  const worker = createAnchorWorker({
    repo: mem.repo,
    sender: chain.sender,
    kv,
    intervalSeconds: 300,
    now: () => clock.t,
    log: quiet,
  });
  return { ...mem, ...chain, kv, worker, clock };
}

describe('anchoring worker', () => {
  it('does nothing when there is nothing to anchor', async () => {
    const s = setup();
    expect(await s.worker.tick()).toEqual({ action: 'idle' });
    expect(s.sent).toHaveLength(0);
  });

  it('waits until the oldest item is 5 minutes old', async () => {
    const s = setup();
    s.add(3, new Date(s.clock.t));
    s.clock.t += 299_000;
    expect(await s.worker.tick()).toEqual({ action: 'waiting' });
    s.clock.t += 1_000;
    expect(await s.worker.tick()).toMatchObject({ action: 'anchored', items: 3 });
  });

  it('anchors "CACHET1" || Merkle root, and every item gets a working inclusion proof', async () => {
    const s = setup();
    s.add(7, new Date(s.clock.t - 400_000));
    const r = await s.worker.tick();
    expect(r).toMatchObject({ action: 'anchored', items: 7 });
    const root = parseAnchorPayload(s.sent[0] as Uint8Array);
    expect(root).toBe(s.anchors[0]?.merkleRoot);
    expect(s.anchors[0]?.status).toBe('finalized');
    const ordered = [...s.items].sort((a, b) => (a.leafIndex ?? 0) - (b.leafIndex ?? 0));
    const tree = buildMerkleTree(ordered.map((i) => i.itemHash));
    expect(tree.root).toBe(root);
    ordered.forEach((item, idx) =>
      expect(verifyMerkleProof(item.itemHash, tree.proofs[idx] ?? [], root ?? '')).toBe(true),
    );
  });

  it('anchors immediately once 500 items wait, in batches of 500', async () => {
    const s = setup();
    s.add(501, new Date(s.clock.t));
    expect(await s.worker.tick()).toMatchObject({ action: 'anchored', items: 500 });
    expect(await s.worker.tick()).toEqual({ action: 'waiting' }); // 1 left, not yet 5 minutes old
  });

  it('only one tick runs at a time (lock)', async () => {
    const s = setup();
    await s.kv.claim('anchor:lock', 300);
    expect(await s.worker.tick({ force: true })).toEqual({ action: 'locked' });
  });

  it('a failed submission releases the items, and the next tick anchors them', async () => {
    const s = setup({ submit: 'throw' });
    s.add(4, new Date(s.clock.t - 400_000));
    expect(await s.worker.tick()).toMatchObject({ action: 'failed' });
    expect(s.anchors[0]?.status).toBe('failed');
    expect(s.items.every((i) => i.anchorId === null)).toBe(true);
    s.mode.submit = 'ok';
    expect(await s.worker.tick()).toMatchObject({ action: 'anchored', items: 4 });
  });

  it('a transaction rejected on chain is not counted as anchored', async () => {
    const s = setup({ outcome: 'failed' });
    s.add(2, new Date(s.clock.t - 400_000));
    expect(await s.worker.tick()).toMatchObject({ action: 'failed' });
    expect(s.items.every((i) => i.anchorId === null)).toBe(true);
  });

  it('after a crash, finishes a claimed-but-unsent anchor first', async () => {
    const s = setup();
    s.add(3, new Date(s.clock.t));
    await s.repo.claimBatch(500); // "crash" right after claiming
    expect(await s.worker.tick()).toMatchObject({ action: 'anchored', items: 3 });
    expect(s.sent).toHaveLength(1);
  });

  it('after a crash, waits for an already-submitted anchor instead of sending it twice', async () => {
    const s = setup();
    s.add(2, new Date(s.clock.t));
    const batch = await s.repo.claimBatch(500);
    await s.repo.markSubmitted(batch?.anchorId ?? 0, 'c'.repeat(64));
    expect(await s.worker.tick()).toMatchObject({ action: 'anchored', txHash: 'c'.repeat(64) });
    expect(s.sent).toHaveLength(0);
  });
});
