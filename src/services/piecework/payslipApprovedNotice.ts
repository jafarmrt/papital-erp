import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '../../db/drizzle.js';
import { personnel, pieceworkPayrolls, users } from '../../db/schema.js';
import { createNotifications } from '../notifications/notificationCreator.js';
import { MY_PAYSLIPS_LINK, payslipApprovedNotice } from '../../lib/notifications/notificationNotices.js';

/**
 * v10.1.42 (messenger notifications plan part 3, ت۳ الف): when a draft payslip is approved, the user linked to its
 * personnel gets one notice (bell and linked messenger) in the approval's own transaction, saying which month's payslip
 * was approved, never its amounts. A personnel without a live linked user gets nothing; insurance, payroll tax and eidi
 * play no part, so a payslip without them notifies the same way.
 */
export async function notifyPayslipApproved(tx: DbTransaction, pay: typeof pieceworkPayrolls.$inferSelect): Promise<boolean> {
  const [owner] = await tx.select({ userId: users.id })
    .from(personnel)
    .innerJoin(users, eq(users.id, personnel.userId))
    .where(and(eq(personnel.id, pay.personnelId), eq(personnel.isDeleted, 0), eq(users.isDeleted, 0)));
  if (!owner) return false;
  const notice = payslipApprovedNotice(pay);
  await createNotifications(tx, [{
    userId: owner.userId,
    category: 'payslip',
    senderId: null,
    senderName: 'حقوق و دستمزد',
    type: 'system',
    title: notice.title,
    message: notice.message,
    link: MY_PAYSLIPS_LINK,
  }]);
  return true;
}
