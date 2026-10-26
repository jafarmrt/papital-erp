import { and, inArray, lt, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { userSessions } from '../../db/schema.js';
import { deletedRowCount, deleteInBatches, OPERATIONAL_PURGE_BATCH_SIZE } from '../../lib/batchDelete.js';

/** a closed or expired session row is kept this many days after it ended (decision ت۴۷ item 4) */
export const ENDED_SESSION_RETENTION_DAYS = 90;

/**
 * 10.3 package 5 (decision ت۴۷ item 4): every login writes a `user_sessions` row and none was ever removed. The daily
 * operational purge (registered by `server.ts`) removes the rows that ended more than `ENDED_SESSION_RETENTION_DAYS`
 * days ago: closed then (logout, closed from the profile or by an admin), or expired then. A row is removed only once it
 * has also expired: a legacy token's first request recreates its missing row as open (`adoptLegacySession`), and no
 * token outlives its row's expiry, so no device can use a removed row. The login and logout audit rows stay.
 */
export async function purgeEndedSessions(olderThanDays: number = ENDED_SESSION_RETENTION_DAYS): Promise<number> {
  const ended = and(
    lt(userSessions.expiresAt, sql`now()`),
    lt(sql`COALESCE(${userSessions.revokedAt}, ${userSessions.expiresAt})`, sql`now() - make_interval(days => ${olderThanDays})`),
  );
  return deleteInBatches(OPERATIONAL_PURGE_BATCH_SIZE, async () => {
    const batch = orm.select({ id: userSessions.id }).from(userSessions).where(ended).limit(OPERATIONAL_PURGE_BATCH_SIZE);
    return deletedRowCount(await orm.delete(userSessions).where(inArray(userSessions.id, batch)));
  });
}
