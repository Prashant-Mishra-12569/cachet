import {
  and,
  anchors,
  asc,
  eq,
  inArray,
  isNull,
  ledgerItems,
  sql,
  type AnchorRow,
  type Db,
} from '@cachet/db';
import { buildMerkleTree } from '@cachet/shared/seal';

export type { AnchorRow };

export interface ClaimedBatch {
  anchorId: number;
  root: string;
  itemCount: number;
}

export interface InclusionData {
  itemHash: string;
  leafIndex: number;
  anchor: AnchorRow;
  /** All item hashes of that anchor, in leaf order (to rebuild the tree and the proof). */
  batch: string[];
}

export interface AnchorRepo {
  /** How many items wait for an anchor, and since when. */
  backlog(): Promise<{ count: number; oldest: Date | null }>;
  /**
   * In ONE transaction: take up to `limit` unanchored items (skipping rows another worker holds),
   * build the Merkle tree, create a pending anchor and give each item its leaf position.
   */
  claimBatch(limit: number): Promise<ClaimedBatch | null>;
  /** Anchors left in 'pending' or 'submitted' (e.g. after a crash) to finish. */
  unfinished(): Promise<AnchorRow[]>;
  markSubmitted(anchorId: number, txHash: string): Promise<void>;
  markFinalized(anchorId: number, blockHash: string): Promise<void>;
  /** Mark failed and release its items so the next batch picks them up again. */
  markFailedAndRelease(anchorId: number, error: string): Promise<void>;
  inclusion(kind: string, refId: string): Promise<InclusionData | null>;
}

export function createAnchorRepo(db: Db): AnchorRepo {
  return {
    async backlog() {
      const rows = await db
        .select({
          count: sql<number>`count(*)::int`,
          oldest: sql<Date | null>`min(${ledgerItems.createdAt})`,
        })
        .from(ledgerItems)
        .where(isNull(ledgerItems.anchorId));
      const r = rows[0];
      return { count: r?.count ?? 0, oldest: r?.oldest ? new Date(r.oldest) : null };
    },

    async claimBatch(limit) {
      return db.transaction(async (tx) => {
        const items = await tx
          .select({ id: ledgerItems.id, itemHash: ledgerItems.itemHash })
          .from(ledgerItems)
          .where(isNull(ledgerItems.anchorId))
          .orderBy(asc(ledgerItems.id))
          .limit(limit)
          .for('update', { skipLocked: true });
        if (items.length === 0) return null;

        const { root } = buildMerkleTree(items.map((i) => i.itemHash));
        const created = await tx
          .insert(anchors)
          .values({ merkleRoot: root, itemCount: items.length, status: 'pending' })
          .returning({ id: anchors.id });
        const anchorId = created[0]?.id;
        if (anchorId === undefined) throw new Error('anchor insert returned no id');

        // One UPDATE for the whole batch: leaf_index = position in the ordered list.
        // Passed as ONE Postgres array literal (a JS array would be expanded into a tuple by drizzle).
        // ids are integers from our own table, so the literal is safe.
        const ids = items.map((i) => i.id);
        const idArray = `{${ids.map((id) => String(Math.trunc(id))).join(',')}}`;
        await tx
          .update(ledgerItems)
          .set({
            anchorId,
            leafIndex: sql`array_position(${idArray}::bigint[], ${ledgerItems.id}) - 1`,
          })
          .where(inArray(ledgerItems.id, ids));
        return { anchorId, root, itemCount: items.length };
      });
    },

    async unfinished() {
      return db
        .select()
        .from(anchors)
        .where(inArray(anchors.status, ['pending', 'submitted']))
        .orderBy(asc(anchors.id));
    },

    async markSubmitted(anchorId, txHash) {
      await db.update(anchors).set({ status: 'submitted', txHash }).where(eq(anchors.id, anchorId));
    },

    async markFinalized(anchorId, blockHash) {
      await db
        .update(anchors)
        .set({ status: 'finalized', blockHash, finalizedAt: sql`now()` })
        .where(eq(anchors.id, anchorId));
    },

    async markFailedAndRelease(anchorId, error) {
      await db.transaction(async (tx) => {
        await tx
          .update(anchors)
          .set({ status: 'failed', error: error.slice(0, 1000) })
          .where(eq(anchors.id, anchorId));
        await tx
          .update(ledgerItems)
          .set({ anchorId: null, leafIndex: null })
          .where(eq(ledgerItems.anchorId, anchorId));
      });
    },

    async inclusion(kind, refId) {
      const rows = await db
        .select({ item: ledgerItems, anchor: anchors })
        .from(ledgerItems)
        .innerJoin(anchors, eq(ledgerItems.anchorId, anchors.id))
        .where(and(eq(ledgerItems.kind, kind), eq(ledgerItems.refId, refId)))
        .limit(1);
      const r = rows[0];
      if (!r || r.item.leafIndex === null) return null;
      const batch = await db
        .select({ itemHash: ledgerItems.itemHash })
        .from(ledgerItems)
        .where(eq(ledgerItems.anchorId, r.anchor.id))
        .orderBy(asc(ledgerItems.leafIndex));
      return {
        itemHash: r.item.itemHash,
        leafIndex: r.item.leafIndex,
        anchor: r.anchor,
        batch: batch.map((b) => b.itemHash),
      };
    },
  };
}
