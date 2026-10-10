import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { dailyWorkLogs, notifications, productionProjects, users } from '../../db/schema.js';
import { computeAuditDiff, logActivity } from '../../lib/auditLogger.js';
import { requireStorageDate } from '../../lib/storageDate.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { DEFAULT_DAILY_LOG_VISIBILITY, idList, mentionNotifies } from '../../lib/dailyLogs/dailyLogVisibility.js';
import { minutesOfDay, timeOfDayLabel, workHoursBetween, workTimeError } from '../../lib/dailyLogs/workHours.js';
import { ROW_ADVISORY_LOCK_NAMESPACES } from '../../lib/advisoryLock.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import type { AuthUserPayload } from '../../types.js';
import type { DailyLogBody, DailyLogUpdateBody } from '../../routes/dailyLogs.schemas.js';
import { canManageAllDailyLogs } from './dailyLogAccess.js';

type Tx = Parameters<Parameters<typeof orm.transaction>[0]>[0];
type DailyLogRow = typeof dailyWorkLogs.$inferSelect;

export const DAILY_LOG_AUDIT_ENTITY = 'گزارش کار روزانه';

/**
 * Package 13: every write of a daily work log (create, edit, manager review, delete) runs here in one transaction with
 * its notifications and its audit row (A02-02 / A02-03 / A02-16).
 *
 * v9.0.231 (TD-626, decision ت۱ الف): another user's log is reviewed, edited or deleted only by a holder of
 * `daily_logs.manage_all` (and the system admin), never by role code; the author edits and deletes their own log.
 * v9.0.234 (TD-629): mentioned and allowed users and the project must exist; the project name comes from the project.
 */
/**
 * v9.0.259 (TD-634, decision ت۵ الف): hours from the shared rule; an end not after the start (or an invalid time) is
 * refused with 422, never stored as 8 hours or counted as an overnight shift.
 */
function requireWorkHours(startTime: string, endTime: string): number {
  const error = workTimeError(startTime, endTime);
  if (error) throw new ValidationError(error, { startTime, endTime }, 'DAILY_LOG_WORK_TIME_INVALID');
  return workHoursBetween(startTime, endTime)!;
}

/**
 * v10.0.91 (TD-1225, finding B12 of the fresh-eyes guide test): two live logs of one author on one work day never
 * overlap in time (one may start where the other ends), so a day never holds more than 24 hours. Checked under the
 * author-day transaction lock; a legacy log without valid times is not compared.
 */
async function assertNoTimeOverlap(tx: Tx, userId: number, date: string, startTime: string, endTime: string, exceptId?: number): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${ROW_ADVISORY_LOCK_NAMESPACES.DAILY_LOG_AUTHOR_DAY}::int, hashtext(${`${userId}:${date}`}::text))`);
  const start = minutesOfDay(startTime)!;
  const end = minutesOfDay(endTime)!;
  const sameDay = await tx.select({ id: dailyWorkLogs.id, title: dailyWorkLogs.title, startTime: dailyWorkLogs.startTime, endTime: dailyWorkLogs.endTime })
    .from(dailyWorkLogs)
    .where(and(
      eq(dailyWorkLogs.userId, userId),
      eq(dailyWorkLogs.date, date),
      eq(dailyWorkLogs.isDeleted, 0),
      ...(exceptId !== undefined ? [ne(dailyWorkLogs.id, exceptId)] : []),
    ));
  const clash = sameDay.find((log) => {
    const s = minutesOfDay(log.startTime ?? '');
    const e = minutesOfDay(log.endTime ?? '');
    return s !== null && e !== null && s < end && start < e;
  });
  if (clash) {
    throw new ValidationError(
      `این بازه با گزارش «${clash.title}» (${timeOfDayLabel(clash.startTime)} تا ${timeOfDayLabel(clash.endTime)}) در همان روز هم‌پوشانی دارد`,
      { overlapsLogId: clash.id },
      'DAILY_LOG_TIME_OVERLAP',
    );
  }
}

const actorName = (actor: AuthUserPayload) => actor.full_name || actor.fullName || actor.username;

/** Existing, non-deleted users among `ids` (sorted, without duplicates); an unknown id refuses the save (422) */
async function resolveUserIds(tx: Tx, ids: number[] | undefined, label: string): Promise<number[]> {
  const unique = [...new Set(ids ?? [])].sort((a, b) => a - b);
  if (unique.length === 0) return [];
  const found = await tx.select({ id: users.id }).from(users)
    .where(and(inArray(users.id, unique), eq(users.isDeleted, 0)));
  const known = new Set(found.map(r => r.id));
  const missing = unique.filter(id => !known.has(id));
  if (missing.length > 0) {
    throw new ValidationError(`${label} با شناسه ${missing.join('، ')} در سامانه نیست`, { missing }, 'DAILY_LOG_USER_NOT_FOUND');
  }
  return unique;
}

/** The project of a log: an existing, non-deleted project, whose title is stored as the project name */
async function resolveProject(tx: Tx, projectId: number | null | '' | undefined): Promise<{ projectId: number | null; projectName: string }> {
  if (projectId === null || projectId === '' || projectId === undefined) return { projectId: null, projectName: '' };
  const [project] = await tx.select({ id: productionProjects.id, title: productionProjects.title }).from(productionProjects)
    .where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)));
  if (!project) throw new ValidationError(`پروژه با شناسه ${projectId} در سامانه نیست`, undefined, 'DAILY_LOG_PROJECT_NOT_FOUND');
  return { projectId: project.id, projectName: project.title };
}

/** One notification for each mentioned user who may read the log and was not already notified (TD-633) */
async function notifyMentions(tx: Tx, log: DailyLogRow, actor: AuthUserPayload, alreadyMentioned: number[]): Promise<void> {
  const fresh = idList(log.mentions).filter(id => !alreadyMentioned.includes(id) && mentionNotifies(log, id));
  const name = actorName(actor);
  for (const userId of fresh) {
    await tx.insert(notifications).values({
      userId,
      senderId: actor.id,
      senderName: name,
      type: 'mention',
      title: 'اشاره در گزارش کار روزانه',
      message: `${name} در گزارش کار روزانه «${log.title}» به شما اشاره کرد.`,
      link: `/daily-logs?id=${log.id}`,
      isRead: 0,
    });
  }
}

/** The row under lock; a missing or deleted log is 404 */
async function lockLog(tx: Tx, logId: number): Promise<DailyLogRow> {
  const [row] = await tx.select().from(dailyWorkLogs)
    .where(and(eq(dailyWorkLogs.id, logId), eq(dailyWorkLogs.isDeleted, 0)))
    .for('update');
  if (!row) throw new NotFoundError('گزارش کار یافت نشد');
  return row;
}

/** The fields an audit row shows (the stored columns the user can change) */
function auditSnapshot(row: DailyLogRow): Record<string, unknown> {
  return {
    date: row.date, startTime: row.startTime, endTime: row.endTime, workHours: row.workHours, workMode: row.workMode,
    title: row.title, content: row.content, projectId: row.projectId, projectName: row.projectName, tags: row.tags,
    mentions: row.mentions, visibility: row.visibility, allowedUsers: row.allowedUsers, status: row.status,
    managerNotes: row.managerNotes, isDeleted: row.isDeleted,
  };
}

async function assertAuthorOrManager(row: DailyLogRow, actor: AuthUserPayload, message: string): Promise<void> {
  if (row.userId === actor.id) return;
  if (await canManageAllDailyLogs(actor)) return;
  throw new ForbiddenError(message, undefined, 'DAILY_LOG_NOT_OWNER');
}

export async function createDailyLog(actor: AuthUserPayload, body: DailyLogBody): Promise<DailyLogRow> {
  const startTime = body.start_time || '08:00';
  const endTime = body.end_time || '17:00';
  const workHours = requireWorkHours(startTime, endTime);
  // v7.0.134 (TD-232): ISO work date; Jalali input is converted and an invalid date is 422
  const date = requireStorageDate(body.date, 'تاریخ کارکرد') || await businessTodayIsoDate();
  const name = actorName(actor);

  return orm.transaction(async (tx) => {
    await assertNoTimeOverlap(tx, actor.id, date, startTime, endTime);
    const mentions = await resolveUserIds(tx, body.mentions, 'کاربر اشاره‌شده');
    const allowedUsers = await resolveUserIds(tx, body.allowed_users, 'کاربر مجاز');
    const project = await resolveProject(tx, body.project_id);
    const [log] = await tx.insert(dailyWorkLogs).values({
      userId: actor.id,
      username: actor.username || 'user',
      userFullName: name || 'کاربر سیستم',
      date,
      dateIso: date,
      startTime,
      endTime,
      workHours,
      workMode: body.work_mode || 'onsite',
      title: body.title,
      content: body.content,
      projectId: project.projectId,
      projectName: project.projectName,
      tags: body.tags ?? [],
      mentions,
      visibility: body.visibility ?? DEFAULT_DAILY_LOG_VISIBILITY,
      allowedUsers,
      status: 'submitted',
    }).returning();
    await notifyMentions(tx, log, actor, []);
    await logActivity({
      tx,
      userId: actor.id,
      username: actor.username,
      userFullName: name,
      action: 'CREATE',
      entity: DAILY_LOG_AUDIT_ENTITY,
      entityId: log.id,
      description: `ثبت گزارش کار روزانه «${log.title}» (${log.workMode === 'remote' ? 'دورکاری' : 'حضوری'}) - کارکرد: ${workHours} ساعت`,
      details: { after: auditSnapshot(log) },
    });
    return log;
  });
}

export async function updateDailyLog(actor: AuthUserPayload, logId: number, body: DailyLogUpdateBody): Promise<DailyLogRow> {
  return orm.transaction(async (tx) => {
    const existing = await lockLog(tx, logId);
    await assertAuthorOrManager(existing, actor, 'شما فقط مجاز به ویرایش گزارش کار خود هستید');

    const startTime = body.start_time !== undefined ? body.start_time : (existing.startTime ?? '');
    const endTime = body.end_time !== undefined ? body.end_time : (existing.endTime ?? '');
    const mentions = body.mentions !== undefined ? await resolveUserIds(tx, body.mentions, 'کاربر اشاره‌شده') : idList(existing.mentions);
    const allowedUsers = body.allowed_users !== undefined ? await resolveUserIds(tx, body.allowed_users, 'کاربر مجاز') : idList(existing.allowedUsers);
    const project = body.project_id !== undefined
      ? await resolveProject(tx, body.project_id)
      : { projectId: existing.projectId, projectName: existing.projectName ?? '' };
    const date = (body.date ? requireStorageDate(body.date, 'تاریخ کارکرد') : '') || existing.date;
    const timeChanged = body.start_time !== undefined || body.end_time !== undefined;
    const workHours = timeChanged ? requireWorkHours(startTime, endTime) : existing.workHours;
    // an edit that keeps the day and the times is not compared, so a legacy overlapping log stays editable
    if (timeChanged || date !== existing.date) {
      if (workTimeError(startTime, endTime) === null) await assertNoTimeOverlap(tx, existing.userId, date, startTime, endTime, logId);
    }

    const [updated] = await tx.update(dailyWorkLogs).set({
      date,
      dateIso: date,
      startTime,
      endTime,
      // an edit that leaves both times keeps the stored hours, so a legacy log stays editable
      workHours,
      workMode: body.work_mode || existing.workMode,
      title: body.title || existing.title,
      content: body.content || existing.content,
      projectId: project.projectId,
      projectName: project.projectName,
      tags: body.tags ?? existing.tags,
      mentions,
      visibility: body.visibility ?? existing.visibility,
      allowedUsers,
    }).where(eq(dailyWorkLogs.id, logId)).returning();

    await notifyMentions(tx, updated, actor, idList(existing.mentions));
    const { diff } = computeAuditDiff(auditSnapshot(existing), auditSnapshot(updated));
    await logActivity({
      tx,
      userId: actor.id,
      username: actor.username,
      userFullName: actorName(actor),
      action: 'UPDATE',
      entity: DAILY_LOG_AUDIT_ENTITY,
      entityId: logId,
      description: existing.userId === actor.id
        ? `ویرایش گزارش کار روزانه «${updated.title}»`
        : `ویرایش گزارش کار روزانه «${updated.title}» از ${existing.userFullName || existing.username}`,
      details: { before: auditSnapshot(existing), after: auditSnapshot(updated), changes: diff },
    });
    return updated;
  });
}

/** Manager review (route guard `daily_logs.manage_all`): sets the notes and notifies the author */
export async function reviewDailyLog(actor: AuthUserPayload, logId: number, managerNotes: string | undefined): Promise<DailyLogRow> {
  return orm.transaction(async (tx) => {
    const existing = await lockLog(tx, logId);
    const [updated] = await tx.update(dailyWorkLogs)
      .set({ status: 'reviewed', managerNotes: managerNotes || '' })
      .where(eq(dailyWorkLogs.id, logId)).returning();
    const name = actorName(actor);
    if (existing.userId !== actor.id) {
      await tx.insert(notifications).values({
        userId: existing.userId,
        senderId: actor.id,
        senderName: name,
        type: 'work_log_review',
        title: 'بازخورد مدیریتی بر گزارش کار',
        message: `${name} برای گزارش کار «${existing.title}» یادداشت و بازخورد ثبت کرد.`,
        link: `/daily-logs?id=${logId}`,
        isRead: 0,
      });
    }
    await logActivity({
      tx,
      userId: actor.id,
      username: actor.username,
      userFullName: name,
      action: 'REVIEW',
      entity: DAILY_LOG_AUDIT_ENTITY,
      entityId: logId,
      description: `ثبت بازخورد مدیریتی بر گزارش کار «${existing.title}» از ${existing.userFullName || existing.username}`,
      details: {
        before: { status: existing.status, managerNotes: existing.managerNotes },
        after: { status: updated.status, managerNotes: updated.managerNotes },
      },
    });
    return updated;
  });
}

export async function deleteDailyLog(actor: AuthUserPayload, logId: number): Promise<void> {
  await orm.transaction(async (tx) => {
    const existing = await lockLog(tx, logId);
    await assertAuthorOrManager(existing, actor, 'شما فقط مجاز به حذف گزارش کار خود هستید');
    await tx.update(dailyWorkLogs).set({ isDeleted: 1 }).where(eq(dailyWorkLogs.id, logId));
    await logActivity({
      tx,
      userId: actor.id,
      username: actor.username,
      userFullName: actorName(actor),
      action: 'DELETE',
      entity: DAILY_LOG_AUDIT_ENTITY,
      entityId: logId,
      description: `حذف گزارش کار روزانه «${existing.title}» از ${existing.userFullName || existing.username}`,
      details: { before: auditSnapshot(existing) },
    });
  });
}
