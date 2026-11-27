import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { pieceworkLogs } from '../../db/schema.js';

/** v12 (migration 0039): the current version of a work log for the body of PUT /piecework/logs/:id, as the edit form sends it */
export async function workLogVersion(id: number | string): Promise<number> {
  const [row] = await orm.select({ version: pieceworkLogs.version }).from(pieceworkLogs).where(eq(pieceworkLogs.id, Number(id)));
  return row?.version ?? 1;
}
