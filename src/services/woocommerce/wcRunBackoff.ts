import { and, desc, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { wcSyncRuns } from '../../db/schema.js';
import { serverTimestampToUtcIso } from '../../lib/serverTimestamp.js';
import { autoPushBackoffMinutes } from '../../lib/woocommerce/wcAutoPush.js';
import type { WcRunKind } from '../../lib/woocommerce/wcShopSync.js';
import { autoRunCondition } from './wcCatalog.service.js';

/**
 * 10.2 package 6 (D-04 parts B and C): automatic runs of one kind (stock, price or SKU) that failed in a row, newest first,
 * and when the next one may run: 1, 2, 4 … at most 30 minutes after the last failure (`autoPushBackoffMinutes`). Each kind
 * waits on its own failures, so a refused price never holds the stock push back.
 */
export async function autoRunBackoff(kind: WcRunKind): Promise<{ failedRuns: number; nextAttemptAt: Date | null }> {
  const runs = await orm.select({ status: wcSyncRuns.status, finishedAt: wcSyncRuns.finishedAt }).from(wcSyncRuns)
    .where(and(eq(wcSyncRuns.kind, kind), autoRunCondition)).orderBy(desc(wcSyncRuns.id)).limit(10);
  let failedRuns = 0;
  while (failedRuns < runs.length && runs[failedRuns].status === 'failed') failedRuns++;
  if (failedRuns === 0 || !runs[0].finishedAt) return { failedRuns, nextAttemptAt: null };
  const last = new Date(serverTimestampToUtcIso(runs[0].finishedAt) ?? '');
  if (Number.isNaN(last.getTime())) return { failedRuns, nextAttemptAt: null };
  return { failedRuns, nextAttemptAt: new Date(last.getTime() + autoPushBackoffMinutes(failedRuns) * 60_000) };
}
