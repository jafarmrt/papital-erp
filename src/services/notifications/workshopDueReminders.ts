import { and, asc, eq, inArray, isNull, notInArray, or } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { notifications, personnel, pieceworkLogs, productionProjects, workshopTaskReports } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import {
  daysUntilDeadline, deadlineLabel, taskDeadlineIso, WORKSHOP_REMINDER_DUE_SOON, workshopReminderKind, workshopRowLink, workshopScheduleRows,
} from '../../lib/workshop/workshopSchedule.js';
import { takeWorkshopReminderScan } from '../../lib/workshop/reminderThrottle.js';

/**
 * v10.1.39 (N-01 part 2, decision ت۸ الف of the mobile workshop plan): the notification bell reminds a workshop worker of
 * their open schedule rows once the day before the deadline (or on it) and once after it. A row with a live work log or a
 * report waiting for review is not reminded. Each reminder is one row per user, kind and schedule row, kept after it is
 * dismissed (`uq_notifications_workshop_reminder`, the TD-717 pattern), so it never comes back and two bell requests make one.
 */
/** The bell's call: the reminder scan, at most once an hour per user, on the pool and never inside a transaction. */
export async function generateWorkshopDueRemindersThrottled(userId: number, nowMs = Date.now()): Promise<number> {
  if (!takeWorkshopReminderScan(userId, nowMs)) return 0;
  return generateWorkshopDueReminders(userId);
}

export async function generateWorkshopDueReminders(userId: number): Promise<number> {
  const [me] = await orm.select({ id: personnel.id }).from(personnel)
    .where(and(eq(personnel.userId, userId), eq(personnel.isDeleted, 0))).orderBy(asc(personnel.id)).limit(1);
  if (!me) return 0;
  const todayIso = await businessTodayIsoDate();
  const projects = await orm.select({
    id: productionProjects.id, projectCode: productionProjects.projectCode, endDate: productionProjects.endDate, stageSchedules: productionProjects.stageSchedules,
  }).from(productionProjects)
    .where(and(eq(productionProjects.isDeleted, 0), or(isNull(productionProjects.status), notInArray(productionProjects.status, ['completed', 'cancelled']))))
    .orderBy(asc(productionProjects.id));

  const due = projects.flatMap(project => workshopScheduleRows(project.stageSchedules)
    .filter(row => row.personnelId === me.id && !row.legacyLogged)
    .map(row => {
      const deadline = taskDeadlineIso(row, project.endDate);
      const days = deadline ? daysUntilDeadline(deadline, todayIso) : null;
      return { project, row, days, kind: workshopReminderKind(days) };
    })
    .filter(x => x.kind !== null));
  if (due.length === 0) return 0;

  const logIds = due.map(d => d.row.pieceworkLogId).filter((id): id is number => id !== null);
  const liveLogs = logIds.length === 0 ? [] : await orm.select({ id: pieceworkLogs.id }).from(pieceworkLogs)
    .where(and(inArray(pieceworkLogs.id, logIds), eq(pieceworkLogs.isDeleted, 0)));
  const live = new Set(liveLogs.map(l => l.id));
  const pending = await orm.select({ projectId: workshopTaskReports.projectId, stageId: workshopTaskReports.stageId, productId: workshopTaskReports.productId, rowId: workshopTaskReports.rowId })
    .from(workshopTaskReports)
    .where(and(eq(workshopTaskReports.personnelId, me.id), inArray(workshopTaskReports.status, ['submitted', 'approved'])));
  const reported = new Set(pending.map(p => `${p.projectId}|${p.stageId}|${p.productId}|${p.rowId}`));

  let created = 0;
  for (const { project, row, days, kind } of due) {
    if (row.pieceworkLogId !== null && live.has(row.pieceworkLogId)) continue;
    if (reported.has(`${project.id}|${row.stageId}|${row.productId}|${row.rowId}`)) continue;
    const link = workshopRowLink({ projectId: project.id, stageId: row.stageId, productId: row.productId, rowId: row.rowId });
    const inserted = await orm.insert(notifications).values({
      userId,
      senderId: null,
      senderName: 'کارتابل کارگاه',
      type: kind as string,
      title: kind === WORKSHOP_REMINDER_DUE_SOON ? '⏰ مهلت کار نزدیک است' : '⏰ مهلت کار گذشته است',
      message: `«${row.taskTitle || 'کار'}» در پروژه ${project.projectCode}: ${deadlineLabel(days)}.`,
      link,
      isRead: 0,
    }).onConflictDoNothing().returning({ id: notifications.id });
    created += inserted.length;
  }
  return created;
}

