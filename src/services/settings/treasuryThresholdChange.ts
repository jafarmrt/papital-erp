import { and, eq, ne, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/drizzle.js';
import { users } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { SYSTEM_ADMIN_ROLE } from '../../lib/permissions/permissionCatalog.js';
import { TREASURY_HIGH_VALUE_THRESHOLD_DEFAULT, resolveTreasuryHighValueThreshold } from '../../lib/settings/settingValues.js';
import { formatPersianNumber } from '../../utils/persianNumber.js';
import { createNotifications } from '../notifications/notificationCreator.js';

/**
 * 10.3 package 5 (10.2 backlog, second review of #324; decision ت۴۷ item 5): any holder of `settings.manage` can raise
 * «آستانه تراکنش کلان خزانه» and so quietly switch off the audit of large treasury rows (`isHighValue`). No new
 * permission is needed; instead a change writes its own activity row (besides the settings row, with the threshold in
 * force before and after) and a bell notice, also sent to a linked messenger as a fixed sentence, to every system admin
 * other than the one who changed it, all in the save's transaction.
 */
export interface ThresholdActor { id?: number; username?: string; fullName?: string }

export const TREASURY_THRESHOLD_ENTITY = 'آستانه تراکنش کلان خزانه';

function rialText(value: number): string {
  return `${formatPersianNumber(value, 0)} ریال`;
}

export async function recordTreasuryThresholdChange(
  tx: DbTransaction, actor: ThresholdActor, stored: { before: string | undefined; after: string },
): Promise<void> {
  const before = resolveTreasuryHighValueThreshold(stored.before);
  const after = resolveTreasuryHighValueThreshold(stored.after);
  const actorName = actor.fullName || actor.username || 'سیستم';
  const direction = after > before ? 'بالا رفت' : after < before ? 'پایین آمد' : 'دوباره ذخیره شد';
  const description = `${TREASURY_THRESHOLD_ENTITY} از ${rialText(before)} به ${rialText(after)} ${direction}`;
  await logActivity({
    tx,
    userId: actor.id,
    username: actor.username || 'سیستم',
    userFullName: actor.fullName || '',
    action: 'SETTING_CHANGE',
    entity: TREASURY_THRESHOLD_ENTITY,
    description,
    details: {
      previousThreshold: before,
      newThreshold: after,
      previousWasDefault: stored.before === undefined,
      defaultThreshold: TREASURY_HIGH_VALUE_THRESHOLD_DEFAULT,
    },
  });
  const admins = await tx.select({ id: users.id }).from(users).where(and(
    eq(users.isDeleted, 0),
    sql`lower(${users.role}) = ${SYSTEM_ADMIN_ROLE}`,
    actor.id ? ne(users.id, actor.id) : sql`true`,
  )).orderBy(users.id);
  if (admins.length === 0) return;
  await createNotifications(tx, admins.map(admin => ({
    userId: admin.id,
    category: 'settings_change' as const,
    type: 'system',
    title: 'تغییر آستانه تراکنش کلان خزانه',
    message: `${description}؛ تغییر به دست ${actorName}.${after > before ? ' تراکنش‌های کمتر از آستانهٔ تازه دیگر «کلان» شمرده نمی‌شوند.' : ''}`,
    link: '/settings',
    senderId: actor.id ?? null,
    senderName: actorName,
  })));
}
