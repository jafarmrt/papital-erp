import { and, eq, gt, ne, sql, type SQL } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { notifications, storefrontSmsMessages } from '../../db/schema.js';
import { logger } from '../../middleware/logger.js';
import {
  SMS_BUDGET_POOL_TITLES, SMS_DAILY_CAP_HOURS, smsBudgetWarnAt, type SmsBudgetPool,
} from '../../lib/storefront/storefrontSmsRules.js';
import { createNotifications } from '../notifications/notificationCreator.js';
import { permissionHolderUserIdsWith } from '../notifications/notificationRecipients.js';
import { STOREFRONT_BOT_USER } from './storefrontCustomer.js';

/**
 * v11 phase 8.4a, v12 phase 8b (site review 2.11): the site's budgets of texts. Login codes (`codes`) and order texts
 * (`orders`) each count against their own hourly budget, and a day holds `SMS_DAILY_CAP_HOURS` times it, so filling one
 * (codes asked for strangers' numbers) never stops the other (a real buyer's order texts). Tests and skipped rows are not
 * spent. Once a budget's hour reaches `SMS_BUDGET_WARN_PERCENT` of it, the colleagues who keep the site's settings
 * (`storefront.manage`) get one bell in that hour; it names the budget only, never a phone or a number of a buyer.
 */
export const SMS_BUDGET_NOTIFY_PERMISSION = 'storefront.manage';

/** Texts spent (or being spent) in the last `seconds`: of one budget, or one phone's order texts */
export async function spentSince(tx: DbExecutor, seconds: number, scope: { pool?: SmsBudgetPool; phoneKey?: string } = {}): Promise<number> {
  const conditions: SQL[] = [
    eq(storefrontSmsMessages.isTest, 0), ne(storefrontSmsMessages.status, 'skipped'),
    sql`${storefrontSmsMessages.createdAt} > now() - make_interval(secs => ${seconds})`,
  ];
  if (scope.pool === 'codes') conditions.push(eq(storefrontSmsMessages.kind, 'otp'));
  if (scope.pool === 'orders' || scope.phoneKey) conditions.push(ne(storefrontSmsMessages.kind, 'otp'));
  if (scope.phoneKey) conditions.push(eq(storefrontSmsMessages.phoneKey, scope.phoneKey));
  const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(storefrontSmsMessages).where(and(...conditions));
  return count;
}

/** Whether a budget is spent: `hourlyCap` in the last hour, or `hourlyCap × SMS_DAILY_CAP_HOURS` in the last day */
export async function smsBudgetSpent(tx: DbExecutor, hourlyCap: number, pool: SmsBudgetPool): Promise<boolean> {
  return await spentSince(tx, 3600, { pool }) >= hourlyCap || await spentSince(tx, 86_400, { pool }) >= hourlyCap * SMS_DAILY_CAP_HOURS;
}

const warningTitle = (pool: SmsBudgetPool) => `سقف ساعتی ${SMS_BUDGET_POOL_TITLES[pool]} سایت نزدیک است`;

const BUDGET_HINTS: Readonly<Record<SmsBudgetPool, string>> = {
  codes: 'اگر خریداران واقعی‌اند سقف را بالا ببرید؛ وگرنه شاید کسی برای شماره‌های دیگران کد می‌خواهد.',
  orders: 'اگر سفارش‌ها واقعی‌اند سقف را بالا ببرید؛ وگرنه شاید سفارش ساختگی ثبت می‌شود.',
};

/**
 * After a text of `pool` was queued: once its hour reaches the warning share of `hourlyCap`, the bell, unless this
 * budget's bell already rang in the last hour. Every read and write is in a savepoint of the caller's transaction, so a
 * failed count or notice is logged and never undoes the text (v12 phase 8b review: the reads were outside it, and a
 * failed one aborted the caller's transaction).
 */
export async function warnIfBudgetNearlySpent(tx: DbExecutor, hourlyCap: number, pool: SmsBudgetPool): Promise<void> {
  try {
    await tx.transaction(async (sp) => {
      if (await spentSince(sp, 3600, { pool }) < smsBudgetWarnAt(hourlyCap)) return;
      const title = warningTitle(pool);
      const [rang] = await sp.select({ id: notifications.id }).from(notifications)
        .where(and(eq(notifications.senderName, STOREFRONT_BOT_USER), eq(notifications.title, title), gt(notifications.createdAt, sql`now() - interval '1 hour'`)))
        .limit(1);
      if (rang) return;
      const recipients = await permissionHolderUserIdsWith(sp, SMS_BUDGET_NOTIFY_PERMISSION);
      await createNotifications(sp, recipients.map(userId => ({
        userId, category: 'site_sms' as const, type: 'system', senderName: STOREFRONT_BOT_USER, title,
        message: `دست‌کم ${smsBudgetWarnAt(hourlyCap).toLocaleString('fa-IR')} پیامک از سقف ${hourlyCap.toLocaleString('fa-IR')} در این ساعت رفته است. ${BUDGET_HINTS[pool]}`,
        link: '/settings',
      })));
    });
  } catch (err) {
    logger.error({ message: 'Error warning colleagues of the site SMS budget', pool, error: err });
  }
}
