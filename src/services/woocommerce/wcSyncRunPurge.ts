import { and, inArray, lt } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { wcSyncRuns } from '../../db/schema.js';
import { deletedRowCount, deleteInBatches, OPERATIONAL_PURGE_BATCH_SIZE } from '../../lib/batchDelete.js';
import { WC_AUTO_RUN_RETENTION_DAYS } from '../../lib/woocommerce/wcAutoPush.js';
import { autoRunCondition } from './wcCatalog.service.js';

/**
 * 10.2 package 6 (D-04 part B, review c): the automatic stock push writes a run row each minute it sends something, so the
 * daily operational purge (registered by `server.ts`) removes automatic run rows older than `WC_AUTO_RUN_RETENTION_DAYS`.
 * Manual pushes and catalog refreshes are never removed.
 */
export async function purgeOldAutoRuns(olderThanDays: number = WC_AUTO_RUN_RETENTION_DAYS): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  // part C: the automatic price and SKU runs go the same way; nightly re-reads (refresh rows) stay
  const purgeable = and(inArray(wcSyncRuns.kind, ['stock_push', 'price_push', 'sku_push']), autoRunCondition, lt(wcSyncRuns.finishedAt, cutoff));
  return deleteInBatches(OPERATIONAL_PURGE_BATCH_SIZE, async () => {
    const batch = orm.select({ id: wcSyncRuns.id }).from(wcSyncRuns).where(purgeable).limit(OPERATIONAL_PURGE_BATCH_SIZE);
    return deletedRowCount(await orm.delete(wcSyncRuns).where(inArray(wcSyncRuns.id, batch)));
  });
}
