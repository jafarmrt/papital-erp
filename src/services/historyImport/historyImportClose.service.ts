import { orm, type DbExecutor } from '../../db/drizzle.js';
import { appSettings } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { HISTORY_IMPORT_CLOSED, HISTORY_IMPORT_CLOSED_KEY, type HistoryImportStatus } from '../../lib/historyImport/historyImportClose.js';
import { idempotentTransaction } from '../../middleware/idempotency.js';
import { readHistoryImportStatus, takeHistoryImportLock } from './importRunner.js';

/**
 * v11 history import, tool 9: «پایان ورود سابقه». The status every user's menus read, and the one-way close by the system
 * admin: it waits for an import that is running (the import lock), then keeps the day, time and user in `app_settings`
 * and writes an audit row. Closing twice is refused.
 */

export async function historyImportStatus(): Promise<HistoryImportStatus> {
  return readHistoryImportStatus(orm);
}

export async function closeHistoryImport(actor: { userId?: number; username?: string; userFullName?: string; req?: unknown }): Promise<HistoryImportStatus> {
  return idempotentTransaction(async (tx: DbExecutor) => {
    await takeHistoryImportLock(tx);
    if ((await readHistoryImportStatus(tx)).closed) {
      throw new ConflictError('ورود سابقه از اکسل پیش‌تر بسته شده است.', undefined, HISTORY_IMPORT_CLOSED);
    }
    const by = actor.userFullName || actor.username || '';
    const at = new Date().toISOString();
    await tx.insert(appSettings).values({ key: HISTORY_IMPORT_CLOSED_KEY, value: JSON.stringify({ at, by, userId: actor.userId ?? null }) });
    await logActivity({
      tx,
      req: actor.req,
      userId: actor.userId,
      username: actor.username,
      userFullName: actor.userFullName,
      action: 'UPDATE',
      entity: 'تنظیمات سیستم',
      entityId: HISTORY_IMPORT_CLOSED_KEY,
      description: 'پایان ورود سابقه: ورود سابقه از اکسل برای همیشه بسته شد',
      details: { setting: HISTORY_IMPORT_CLOSED_KEY, closedAt: at },
    });
    return { closed: true, closedAt: at, closedBy: by };
  });
}
