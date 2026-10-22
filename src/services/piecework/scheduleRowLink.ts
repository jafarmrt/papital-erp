import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { pieceworkLogs, productionProjects } from '../../db/schema.js';
import { ConflictError, ValidationError } from '../../errors/customErrors.js';
import { findScheduleRow, withScheduleLogLink, withoutScheduleLogLink, type ScheduleRowRef } from '../../lib/projects/scheduleWorkLog.js';
import { workshopScheduleRows } from '../../lib/workshop/workshopSchedule.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v9.0.282 (TD-736، تصمیم ت۵ الف بسته ۱۱): پیوند کارکرد و ردیف برنامه کارگاه پروژه (`production_projects.stage_schedules`).
 * ثبت کارکردی که `scheduleRef` دارد ردیف پروژه را `FOR UPDATE` قفل می‌کند، ردیف برنامه را می‌خواهد (همان پرسنل و همان عنوان
 * کار)، ردیفی را که کارکرد زنده دارد با ۴۰۹ `PIECEWORK_SCHEDULE_ROW_LOGGED` رد می‌کند و شناسه کارکرد تازه را در همان ردیف
 * می‌نویسد؛ حذف کارکرد پیوند را برمی‌دارد تا ردیف دوباره ثبت‌شدنی باشد. دو ثبت هم‌زمان یک ردیف پشت قفل پروژه می‌مانند.
 */

export interface ScheduledEntry {
  personnelId: number;
  taskId: number;
  projectId: number | null;
  scheduleRef: ScheduleRowRef | null;
  /** مقدار کارکرد (عدد یا ساعت به عدد)؛ v10.0.185 (TD-955) با مقدار ردیف برنامه سنجیده می‌شود */
  quantity?: number;
}

/** برنامه و نسخه هر پروژه قفل‌شده (خواندن، محاسبه در TypeScript، نوشتن) */
type Schedules = Map<number, { schedules: unknown; version: number }>;

const rowName = (ref: ScheduleRowRef) => `ردیف برنامه «${ref.rowId}» (مرحله ${toPersianDigits(ref.stageId)})`;

/** v10.0.185 (TD-955، تصمیم ت۱۰ فاز ۵): کارکرد ردیف برنامه بیش از مقدار همان ردیف نیست؛ پیش‌تر ۵۰۰ برای ردیف ۲۰ پذیرفته می‌شد */
function assertWithinRowQuantity(ref: ScheduleRowRef, quantity: number, planned: number): void {
  if (!Number.isFinite(planned) || planned <= 0 || quantity <= planned + 1e-9) return;
  throw new ValidationError(
    `مقدار کارکرد (${toPersianDigits(quantity)}) بیش از مقدار ${rowName(ref)} (${toPersianDigits(planned)}) است؛ مقدار ردیف را در برنامه اصلاح و ذخیره کنید.`,
    { scheduleRef: ref, quantity, plannedQuantity: planned }, 'PIECEWORK_SCHEDULE_ROW_QUANTITY_EXCEEDED',
  );
}

/**
 * پروژه‌های ردیف‌های برنامه را به ترتیب شناسه قفل می‌کند و برنامه هر کدام را برمی‌گرداند (پیش از قفل‌های اشتراکی والدها).
 * 10.2 package 12 (TD-1347, review M4 of #329): a batch with a schedule row locks every project of the batch, not only the
 * scheduled ones. A schedule row in project A with a manual log in B, run beside the mirror batch, took A exclusively, then
 * waited for a shared lock on B held exclusively by the other batch, and deadlocked.
 */
export async function lockScheduleProjects(tx: DbExecutor, entries: readonly ScheduledEntry[]): Promise<Schedules> {
  const scheduled = entries.filter(e => e.scheduleRef);
  const schedules: Schedules = new Map();
  if (scheduled.length === 0) return schedules;
  if (scheduled.some(e => e.projectId === null)) {
    throw new ValidationError('کارکرد ردیف برنامه کارگاه بی پروژه ثبت نمی‌شود.', undefined, 'PIECEWORK_SCHEDULE_PROJECT_REQUIRED');
  }
  const ids = [...new Set(entries.map(e => e.projectId).filter((id): id is number => id !== null))].sort((a, b) => a - b);
  const rows = await tx.select({ id: productionProjects.id, stageSchedules: productionProjects.stageSchedules, version: productionProjects.version }).from(productionProjects)
    .where(and(inArray(productionProjects.id, ids), eq(productionProjects.isDeleted, 0))).orderBy(asc(productionProjects.id)).for('update');
  for (const row of rows) schedules.set(row.id, { schedules: row.stageSchedules, version: row.version });
  return schedules;
}

/** هر ردیف برنامه هست، با پرسنل و عنوان کار کارکرد می‌خواند، در دسته تکرار نشده و کارکرد زنده ندارد */
export async function assertScheduleRowsFree(tx: DbExecutor, entries: readonly ScheduledEntry[], schedules: Schedules): Promise<void> {
  const seen = new Set<string>();
  const linkedLogIds: Array<{ ref: ScheduleRowRef; logId: number }> = [];
  for (const entry of entries) {
    const ref = entry.scheduleRef;
    if (!ref || entry.projectId === null || !schedules.has(entry.projectId)) continue;
    const key = `${entry.projectId}|${ref.stageId}|${ref.productId}|${ref.rowId}`;
    if (seen.has(key)) throw new ConflictError(`${rowName(ref)} دو بار در یک ثبت آمده است.`, { scheduleRef: ref }, 'PIECEWORK_SCHEDULE_ROW_LOGGED');
    seen.add(key);
    const row = findScheduleRow(schedules.get(entry.projectId)?.schedules, ref.stageId, ref.productId, ref.rowId);
    if (!row) {
      throw new ValidationError(`${rowName(ref)} در برنامه ذخیره‌شده پروژه نیست؛ برنامه را ذخیره کنید و دوباره ثبت کنید.`, { scheduleRef: ref }, 'PIECEWORK_SCHEDULE_ROW_NOT_FOUND');
    }
    if (Number(row.assignedPersonnelId) !== entry.personnelId || Number(row.taskId) !== entry.taskId) {
      throw new ValidationError(`پرسنل یا عنوان کار ${rowName(ref)} با کارکرد ارسالی یکی نیست؛ برنامه را ذخیره کنید و دوباره ثبت کنید.`, { scheduleRef: ref }, 'PIECEWORK_SCHEDULE_ROW_MISMATCH');
    }
    if (entry.quantity !== undefined) assertWithinRowQuantity(ref, entry.quantity, Number(row.quantity));
    const logId = Number(row.pieceworkLogId);
    if (Number.isInteger(logId) && logId > 0) linkedLogIds.push({ ref, logId });
    else if (row.isLoggedToPiecework === true) {
      throw new ConflictError(`کارکرد ${rowName(ref)} پیش‌تر ثبت شده است.`, { scheduleRef: ref }, 'PIECEWORK_SCHEDULE_ROW_LOGGED');
    }
  }
  if (linkedLogIds.length === 0) return;
  const live = await tx.select({ id: pieceworkLogs.id }).from(pieceworkLogs)
    .where(and(inArray(pieceworkLogs.id, linkedLogIds.map(l => l.logId)), eq(pieceworkLogs.isDeleted, 0)));
  const taken = linkedLogIds.find(l => live.some(r => r.id === l.logId));
  if (taken) {
    throw new ConflictError(`کارکرد ${rowName(taken.ref)} پیش‌تر ثبت شده است (کارکرد شماره ${toPersianDigits(taken.logId)}).`, { scheduleRef: taken.ref, pieceworkLogId: taken.logId }, 'PIECEWORK_SCHEDULE_ROW_LOGGED');
  }
}

/** شناسه کارکردهای تازه را در ردیف‌های برنامه می‌نویسد (یک به‌روزرسانی برای هر پروژه) */
export async function linkScheduleRows(tx: DbExecutor, links: ReadonlyArray<{ projectId: number; ref: ScheduleRowRef; logId: number }>, schedules: Schedules): Promise<void> {
  const changed = new Set<number>();
  for (const link of links) {
    const current = schedules.get(link.projectId);
    if (!current) continue;
    schedules.set(link.projectId, { ...current, schedules: withScheduleLogLink(current.schedules, link.ref, link.logId) });
    changed.add(link.projectId);
  }
  for (const projectId of changed) {
    const current = schedules.get(projectId);
    if (!current) continue;
    await tx.update(productionProjects)
      .set({ stageSchedules: current.schedules, version: current.version + 1 })
      .where(eq(productionProjects.id, projectId));
  }
}

/** کارکردی که به پروژه دیگر می‌رود: هر دو پروژه به ترتیب شناسه `FOR UPDATE` قفل می‌شوند (همان ترتیب دو جابه‌جایی هم‌زمان) */
export async function lockProjectsOfLogMove(tx: DbExecutor, from: number | null, to: number | null): Promise<void> {
  const ids = [...new Set([from, to].filter((id): id is number => id !== null))].sort((a, b) => a - b);
  if (ids.length === 0) return;
  await tx.select({ id: productionProjects.id }).from(productionProjects)
    .where(inArray(productionProjects.id, ids)).orderBy(asc(productionProjects.id)).for('update');
}

/**
 * کارکرد حذف شد یا به پروژه دیگر رفت: ردیف برنامه‌ای که به آن اشاره دارد دوباره ثبت‌شدنی می‌شود. 10.2 بستهٔ ۱۲ (D6):
 * برمی‌گرداند که ردیفی پیوند داشت یا نه، تا پیشرفت همان پروژه دوباره حساب شود.
 */
export async function unlinkScheduleRow(tx: DbExecutor, projectId: number | null, logId: number): Promise<boolean> {
  if (projectId === null) return false;
  const [project] = await tx.select({ id: productionProjects.id, stageSchedules: productionProjects.stageSchedules, version: productionProjects.version }).from(productionProjects)
    .where(eq(productionProjects.id, projectId)).for('update');
  if (!project) return false;
  const { changed, schedules } = withoutScheduleLogLink(project.stageSchedules, logId);
  if (!changed) return false;
  await tx.update(productionProjects)
    .set({ stageSchedules: schedules, version: project.version + 1 })
    .where(eq(productionProjects.id, projectId));
  return true;
}

/**
 * 10.2 بستهٔ ۱۲ (D6): کارکرد به ردیفی از برنامهٔ کارگاه پروژه پیوند دارد (تغییر مقدارش پیشرفت پروژه را عوض می‌کند).
 * 10.2 package 12 (TD-1346, review M3 of #329): the edit's new quantity stays within the row, as on create (TD-955); before,
 * an edit took 500 on a row of 10 and the payslip paid 50 times the plan. A linked log locks the project row `FOR UPDATE`
 * after the log row (the order of a delete and of the progress sync that follows), so a schedule save cannot lower the row
 * between this check and the write; a manual log's edit still takes no project lock. A stored log already above its row is
 * left as it is; only an edit to another quantity above the row is refused.
 */
export async function assertLinkedRowQuantity(tx: DbExecutor, projectId: number | null, logId: number, quantity: number): Promise<boolean> {
  if (projectId === null) return false;
  const linkedRow = (schedules: unknown) => workshopScheduleRows(schedules).find(r => r.pieceworkLogId === logId);
  const read = () => tx.select({ stageSchedules: productionProjects.stageSchedules }).from(productionProjects).where(eq(productionProjects.id, projectId));
  const [seen] = await read();
  if (!seen || !linkedRow(seen.stageSchedules)) return false;
  const [project] = await read().for('update');
  const row = project ? linkedRow(project.stageSchedules) : undefined;
  if (!row) return false;
  assertWithinRowQuantity({ stageId: row.stageId, productId: row.productId, rowId: row.rowId }, quantity, row.quantity);
  return true;
}
