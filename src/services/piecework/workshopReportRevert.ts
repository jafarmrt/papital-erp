import { and, asc, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { notifications, workshopTaskReports } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { WORKSHOP_REPORT_LOG_REMOVED_NOTE } from '../../lib/workshop/workshopSchedule.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { workerUserIds } from '../workshop/workshopAccess.js';
import { actorFields, type AuditActor } from './pieceworkAudit.js';

/**
 * v10.1.39 (N-01 part 2, TD-1284 review finding): a work log written by approving a workshop report was deleted or moved
 * to another project. The schedule row is free again (`unlinkScheduleRow`), so the report stops being the row's live
 * approved report: it becomes «ردشده» with a note saying why, under its row lock, with its audit row in the same
 * transaction. Otherwise the stage progress would still count it and the row could never take a new report.
 * v10.1.40 (TD-1285, review of TD-1284): the worker is told in the same transaction, so a report they saw approved
 * never turns «ردشده» without a word.
 */
export async function revertWorkshopReportsOfLog(tx: DbExecutor, logId: number, actor: AuditActor): Promise<number> {
  const reports = await tx.select().from(workshopTaskReports)
    .where(and(eq(workshopTaskReports.pieceworkLogId, logId), eq(workshopTaskReports.status, 'approved')))
    .orderBy(asc(workshopTaskReports.id)).for('update');
  for (const report of reports) {
    const [updated] = await tx.update(workshopTaskReports).set({
      status: 'rejected',
      reviewNote: WORKSHOP_REPORT_LOG_REMOVED_NOTE,
      updatedAt: sql`now()`,
      version: report.version + 1,
    }).where(eq(workshopTaskReports.id, report.id)).returning();
    await logActivity({
      tx,
      ...actorFields(actor),
      action: 'UPDATE',
      entity: 'گزارش کار کارگاه',
      entityId: String(report.id),
      description: `برگشت گزارش پایان کار شماره ${toPersianDigits(report.id)} پس از حذف یا جابه‌جایی کارکرد شماره ${toPersianDigits(logId)}`,
      details: {
        projectId: report.projectId,
        rowId: report.rowId,
        pieceworkLogId: logId,
        before: { status: 'تأییدشده' },
        after: { status: 'ردشده', reviewNote: updated?.reviewNote ?? WORKSHOP_REPORT_LOG_REMOVED_NOTE },
      },
    });
    await notifyWorkerOfRevert(tx, report.personnelId, report.id, actor);
  }
  return reports.length;
}

async function notifyWorkerOfRevert(tx: DbExecutor, personnelId: number, reportId: number, actor: AuditActor): Promise<void> {
  const { userId: senderId, username } = actorFields(actor);
  const recipients = (await workerUserIds(tx, personnelId)).filter(id => id !== senderId);
  if (recipients.length === 0) return;
  await tx.insert(notifications).values(recipients.map(userId => ({
    userId,
    senderId: senderId ?? null,
    senderName: username || 'کارتابل کارگاه',
    type: 'workshop_report_reverted',
    title: 'گزارش پایان کار برگشت خورد',
    message: `کارکرد گزارش شماره ${toPersianDigits(reportId)} حذف یا به پروژه دیگری برده شد؛ گزارش ردشده است و می‌توانید دوباره گزارش دهید.`,
    link: '/workshop',
    isRead: 0,
  })));
}
