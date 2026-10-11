import { inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { users } from '../../db/schema.js';

/**
 * TD-1230 (fresh-eyes work-map B-05): the full name of each voucher maker, so the voucher list shows a person
 * instead of a username; a user without a full name (or a removed user) is left out and the list falls back to the username.
 */
export async function voucherMakerNames(executor: DbExecutor, makerIds: Array<number | null | undefined>): Promise<Map<number, string>> {
  const ids = [...new Set(makerIds.filter((id): id is number => typeof id === 'number' && id > 0))];
  const names = new Map<number, string>();
  if (ids.length === 0) return names;
  const rows = await executor.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, ids));
  for (const row of rows) {
    const name = (row.fullName ?? '').trim();
    if (name) names.set(row.id, name);
  }
  return names;
}
