import { and, asc, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { workshopTaskReports } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { WORKSHOP_REPORT_LOG_REMOVED_NOTE } from '../../lib/workshop/workshopSchedule.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { actorFields, type AuditActor } from './pieceworkAudit.js';

/**
 * v10.1.39 (N-01 part 2, TD-1284 review finding): a work log written by approving a workshop report was deleted or moved
 * to another project. The schedule row is free again (`unlinkScheduleRow`), so the report stops being the row's live
 * approved report: it becomes «ردشده» with a note saying why, under its row lock, with its audit row in the same
 * transaction. Otherwise the stage progress would still count it and the row could never take a new report.
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
  }
  return reports.length;
}
