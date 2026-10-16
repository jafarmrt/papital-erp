/**
 * OBS-R2-10: batched deletes of the daily operational purge. Each batch is its own statement, so a large first backlog
 * never meets the pool's statement timeout in one go, and only row counts reach Node, never the deleted rows.
 */

/** Rows one purge statement deletes at most */
export const OPERATIONAL_PURGE_BATCH_SIZE = 5000;

/** The row count of a node-postgres delete result (0 when the driver gives none) */
export function deletedRowCount(result: unknown): number {
  const rowCount = (result as { rowCount?: number | null } | null)?.rowCount;
  return typeof rowCount === 'number' ? rowCount : 0;
}

/**
 * Runs `deleteBatch` until a batch deletes fewer than `batchSize` rows and returns the total deleted.
 * `batchSize` must be a positive whole number.
 */
export async function deleteInBatches(batchSize: number, deleteBatch: () => Promise<number>): Promise<number> {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new RangeError(`batchSize must be a positive whole number, got ${batchSize}`);
  let total = 0;
  for (;;) {
    const deleted = await deleteBatch();
    total += deleted;
    if (deleted < batchSize) return total;
  }
}
