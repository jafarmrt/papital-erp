import { and, asc, desc, eq, gte, inArray, notInArray, or, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { personnel, pieceworkLogs, productionProjects, projectStages, workshopTaskReports } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import type {
  MyWorkshopTasks, ProjectWorkshopReports, WorkshopApprovedReport, WorkshopManualLog, WorkshopReportView, WorkshopReviewItem, WorkshopStageProgress,
  WorkshopTaskCard,
} from '../../lib/workshop/workshopContract.js';
import {
  daysUntilDeadline, taskDeadlineIso, workshopScheduleRows, type WorkshopReportStatus, type WorkshopScheduleRow,
} from '../../lib/workshop/workshopSchedule.js';
import { scheduleRowDoneQuantity, workPercent, workProgressOf } from '../../lib/workshop/scheduleWorkProgress.js';
import { reviewableProjectIds, requireLinkedPersonnel, type WorkshopUser } from './workshopAccess.js';

/**
 * v10.1.39 (N-01 part 2, plan §4.3 «کارهای من» and «بررسی مسئول پروژه»): the worker's open schedule rows and the
 * reports waiting for a project manager. A row is open while its project is neither completed nor cancelled and it has
 * no live work log; its report is its submitted or latest report.
 */

/** Projects a workshop row may still be worked on. */
export const CLOSED_PROJECT_STATUSES = ['completed', 'cancelled'];
const APPROVED_WINDOW_DAYS = 30;

type ProjectRow = { id: number; projectCode: string; title: string; endDate: string | null; status: string | null; stageSchedules: unknown; products: unknown };
type ReportRow = typeof workshopTaskReports.$inferSelect;

const rowKey = (projectId: number, stageId: number, productId: string, rowId: string) => `${projectId}|${stageId}|${productId}|${rowId}`;

export function reportView(r: ReportRow): WorkshopReportView {
  return {
    id: r.id,
    status: r.status as WorkshopReportStatus,
    quantity: Number(r.quantity),
    approvedQuantity: r.approvedQuantity === null ? null : Number(r.approvedQuantity),
    notes: r.notes,
    reviewNote: r.reviewNote,
    version: r.version,
    createdAt: r.createdAt,
    reviewedAt: r.reviewedAt,
  };
}

/** The display name of a schedule product: its schedule's name, else the project's product of that id. */
export function productNameOf(products: unknown, row: Pick<WorkshopScheduleRow, 'productId' | 'productName'>): string {
  if (row.productName) return row.productName;
  const list = Array.isArray(products) ? products : [];
  const found = list.find((p: { id?: unknown }) => String(p?.id) === row.productId) as { item_name?: string; itemName?: string } | undefined;
  return found?.item_name || found?.itemName || '';
}

async function stageTitles(executor: DbExecutor, stageIds: number[]): Promise<Map<number, { title: string; stageOrder: number }>> {
  const map = new Map<number, { title: string; stageOrder: number }>();
  const ids = [...new Set(stageIds)];
  if (ids.length === 0) return map;
  const rows = await executor.select({ id: projectStages.id, title: projectStages.title, stageOrder: projectStages.stageOrder }).from(projectStages)
    .where(and(inArray(projectStages.id, ids), eq(projectStages.isDeleted, 0)));
  for (const r of rows) map.set(r.id, { title: r.title, stageOrder: r.stageOrder });
  return map;
}

/** Ids among `logIds` of work logs that are not deleted. */
export async function liveLogIds(executor: DbExecutor, logIds: number[]): Promise<Set<number>> {
  const ids = [...new Set(logIds)];
  if (ids.length === 0) return new Set();
  const rows = await executor.select({ id: pieceworkLogs.id }).from(pieceworkLogs)
    .where(and(inArray(pieceworkLogs.id, ids), eq(pieceworkLogs.isDeleted, 0)));
  return new Set(rows.map(r => r.id));
}

/** A row is done once it has a live work log, or carries the pre-v9.0.282 logged flag. */
export function rowHasLiveLog(row: WorkshopScheduleRow, live: Set<number>): boolean {
  return row.legacyLogged || (row.pieceworkLogId !== null && live.has(row.pieceworkLogId));
}

async function openProjects(executor: DbExecutor, ids?: number[]): Promise<ProjectRow[]> {
  if (ids && ids.length === 0) return [];
  return executor.select({
    id: productionProjects.id, projectCode: productionProjects.projectCode, title: productionProjects.title, endDate: productionProjects.endDate,
    status: productionProjects.status, stageSchedules: productionProjects.stageSchedules, products: productionProjects.products,
  }).from(productionProjects)
    .where(and(
      eq(productionProjects.isDeleted, 0),
      or(sql`${productionProjects.status} IS NULL`, notInArray(productionProjects.status, CLOSED_PROJECT_STATUSES)),
      ids ? inArray(productionProjects.id, ids) : undefined,
    ))
    .orderBy(asc(productionProjects.id));
}

/** «کارهای من»: open rows assigned to the user's personnel, nearest deadline first, and their approved reports of 30 days. */
export async function listMyTasks(executor: DbExecutor, user: WorkshopUser): Promise<MyWorkshopTasks> {
  const me = await requireLinkedPersonnel(executor, user.id);
  const todayIso = await businessTodayIsoDate();
  const projects = await openProjects(executor);
  const mine = projects.flatMap(project => workshopScheduleRows(project.stageSchedules)
    .filter(row => row.personnelId === me.id)
    .map(row => ({ project, row })));
  const live = await liveLogIds(executor, mine.map(m => m.row.pieceworkLogId).filter((id): id is number => id !== null));
  const open = mine.filter(m => !rowHasLiveLog(m.row, live));

  const reports = open.length === 0 ? [] : await executor.select().from(workshopTaskReports)
    .where(and(eq(workshopTaskReports.personnelId, me.id), inArray(workshopTaskReports.projectId, [...new Set(open.map(m => m.project.id))])))
    .orderBy(desc(workshopTaskReports.id));
  const reportOf = new Map<string, ReportRow>();
  for (const r of reports) {
    const key = rowKey(r.projectId, r.stageId, r.productId, r.rowId);
    const current = reportOf.get(key);
    // the live (submitted) report wins, else the latest one
    if (!current || (r.status === 'submitted' && current.status !== 'submitted')) reportOf.set(key, r);
  }
  const stages = await stageTitles(executor, open.map(m => m.row.stageId));

  const tasks: WorkshopTaskCard[] = open.map(({ project, row }) => {
    const deadline = taskDeadlineIso(row, project.endDate);
    const report = reportOf.get(rowKey(project.id, row.stageId, row.productId, row.rowId));
    return {
      projectId: project.id,
      projectCode: project.projectCode,
      projectTitle: project.title,
      stageId: row.stageId,
      stageTitle: stages.get(row.stageId)?.title ?? '',
      productId: row.productId,
      productName: productNameOf(project.products, row),
      rowId: row.rowId,
      taskId: row.taskId,
      taskTitle: row.taskTitle,
      quantity: row.quantity,
      unit: row.unit,
      deadline,
      daysLeft: deadline ? daysUntilDeadline(deadline, todayIso) : null,
      report: report ? reportView(report) : null,
    };
  }).sort((a, b) => (a.daysLeft ?? Number.MAX_SAFE_INTEGER) - (b.daysLeft ?? Number.MAX_SAFE_INTEGER) || a.projectId - b.projectId);

  return { personnel: me, tasks, approved: await approvedReports(executor, me.id) };
}

async function approvedReports(executor: DbExecutor, personnelId: number): Promise<WorkshopApprovedReport[]> {
  const rows = await executor.select({
    report: workshopTaskReports, projectCode: productionProjects.projectCode, projectTitle: productionProjects.title,
    products: productionProjects.products, schedules: productionProjects.stageSchedules, amount: pieceworkLogs.totalAmount,
  }).from(workshopTaskReports)
    .innerJoin(productionProjects, eq(productionProjects.id, workshopTaskReports.projectId))
    .innerJoin(pieceworkLogs, and(eq(pieceworkLogs.id, workshopTaskReports.pieceworkLogId), eq(pieceworkLogs.isDeleted, 0)))
    .where(and(
      eq(workshopTaskReports.personnelId, personnelId),
      eq(workshopTaskReports.status, 'approved'),
      gte(workshopTaskReports.reviewedAt, sql`now() - make_interval(days => ${APPROVED_WINDOW_DAYS})`),
    ))
    .orderBy(desc(workshopTaskReports.reviewedAt)).limit(100);
  const stages = await stageTitles(executor, rows.map(r => r.report.stageId));
  return rows.map(r => {
    const row = workshopScheduleRows(r.schedules).find(x => x.stageId === r.report.stageId && x.productId === r.report.productId && x.rowId === r.report.rowId);
    return {
      reportId: r.report.id,
      projectCode: r.projectCode,
      projectTitle: r.projectTitle,
      stageTitle: stages.get(r.report.stageId)?.title ?? '',
      productName: row ? productNameOf(r.products, row) : '',
      taskTitle: row?.taskTitle ?? '',
      quantity: Number(r.report.approvedQuantity ?? r.report.quantity),
      amount: r.amount.toNumber(),
      reviewedAt: r.report.reviewedAt,
    };
  });
}

/**
 * Live work logs of a worker and task in a project that no schedule row of that project links: logs recorded by hand on
 * the piecework page. Approving a workshop report beside one could pay the same work twice, so the reviewer sees them and
 * acknowledges them first (review finding of TD-1284). Keyed `projectId|personnelId|taskId`.
 */
export async function manualWorkLogs(
  executor: DbExecutor,
  projects: ReadonlyArray<{ id: number; stageSchedules: unknown }>,
  keys: ReadonlyArray<{ projectId: number; personnelId: number; taskId: number | null }>,
): Promise<Map<string, WorkshopManualLog[]>> {
  const result = new Map<string, WorkshopManualLog[]>();
  const wanted = keys.filter((k): k is { projectId: number; personnelId: number; taskId: number } => k.taskId !== null);
  if (wanted.length === 0) return result;
  const rows = await executor.select({
    id: pieceworkLogs.id, projectId: pieceworkLogs.projectId, personnelId: pieceworkLogs.personnelId, taskId: pieceworkLogs.taskId,
    date: pieceworkLogs.date, dateIso: pieceworkLogs.dateIso, quantity: pieceworkLogs.quantity,
  }).from(pieceworkLogs)
    .where(and(
      eq(pieceworkLogs.isDeleted, 0),
      inArray(pieceworkLogs.projectId, [...new Set(wanted.map(k => k.projectId))]),
      inArray(pieceworkLogs.personnelId, [...new Set(wanted.map(k => k.personnelId))]),
      inArray(pieceworkLogs.taskId, [...new Set(wanted.map(k => k.taskId))]),
    ))
    .orderBy(asc(pieceworkLogs.id));
  const scheduled = new Set(projects.flatMap(p => workshopScheduleRows(p.stageSchedules).map(r => r.pieceworkLogId)).filter((id): id is number => id !== null));
  const wantedKeys = new Set(wanted.map(k => `${k.projectId}|${k.personnelId}|${k.taskId}`));
  for (const r of rows) {
    const key = `${r.projectId}|${r.personnelId}|${r.taskId}`;
    if (scheduled.has(r.id) || !wantedKeys.has(key)) continue;
    const list = result.get(key) ?? [];
    list.push({ id: r.id, date: r.dateIso || r.date, quantity: Number(r.quantity) });
    result.set(key, list);
  }
  return result;
}

async function reviewItems(executor: DbExecutor, user: WorkshopUser, reports: ReportRow[]): Promise<WorkshopReviewItem[]> {
  if (reports.length === 0) return [];
  const projects = await executor.select({
    id: productionProjects.id, projectCode: productionProjects.projectCode, title: productionProjects.title, endDate: productionProjects.endDate,
    stageSchedules: productionProjects.stageSchedules, products: productionProjects.products,
  }).from(productionProjects).where(inArray(productionProjects.id, [...new Set(reports.map(r => r.projectId))]));
  const byId = new Map(projects.map(p => [p.id, p]));
  const names = await executor.select({ id: personnel.id, fullName: personnel.fullName, userId: personnel.userId }).from(personnel)
    .where(inArray(personnel.id, [...new Set(reports.map(r => r.personnelId))]));
  const nameOf = new Map(names.map(n => [n.id, n.fullName]));
  const userOf = new Map(names.map(n => [n.id, n.userId]));
  // the rule the approval checks (assertNotOwnReport), so the page offers no button the server refuses
  const isOwn = (r: ReportRow) => !user.isAdmin && (userOf.get(r.personnelId) === user.id || r.createdById === user.id);
  const stages = await stageTitles(executor, reports.map(r => r.stageId));
  const manual = await manualWorkLogs(executor, projects, reports.map(r => ({ projectId: r.projectId, personnelId: r.personnelId, taskId: r.taskId })));
  return reports.map(r => {
    const project = byId.get(r.projectId);
    const row = workshopScheduleRows(project?.stageSchedules).find(x => x.stageId === r.stageId && x.productId === r.productId && x.rowId === r.rowId);
    return {
      report: reportView(r),
      projectId: r.projectId,
      projectCode: project?.projectCode ?? '',
      projectTitle: project?.title ?? '',
      stageId: r.stageId,
      stageTitle: stages.get(r.stageId)?.title ?? '',
      productId: r.productId,
      productName: row ? productNameOf(project?.products, row) : '',
      rowId: r.rowId,
      taskTitle: row?.taskTitle ?? '',
      plannedQuantity: row?.quantity ?? 0,
      unit: row?.unit ?? 'عدد',
      personnelId: r.personnelId,
      personnelName: nameOf.get(r.personnelId) ?? '',
      deadline: row ? taskDeadlineIso(row, project?.endDate) : null,
      manualLogs: manual.get(`${r.projectId}|${r.personnelId}|${r.taskId}`) ?? [],
      isOwn: isOwn(r),
    };
  });
}

/** Reports waiting for this reviewer: submitted reports of the projects they manage (every project for the admin). */
export async function listReviewReports(executor: DbExecutor, user: WorkshopUser, projectId?: number): Promise<WorkshopReviewItem[]> {
  const scope = await reviewableProjectIds(executor, user);
  if (scope && scope.length === 0) return [];
  const reports = await executor.select().from(workshopTaskReports)
    .where(and(
      eq(workshopTaskReports.status, 'submitted'),
      scope ? inArray(workshopTaskReports.projectId, scope) : undefined,
      projectId ? eq(workshopTaskReports.projectId, projectId) : undefined,
    ))
    .orderBy(asc(workshopTaskReports.createdAt), asc(workshopTaskReports.id)).limit(500);
  return reviewItems(executor, user, reports);
}

/**
 * Per stage: the done work of its schedule rows (10.2 package 12, D6: the same rule as the progress matrix, each row's live
 * work log quantity up to the row, so a log the project recorded from the schedule tab counts as an approved report does).
 * `unit` is null when the stage's rows have several units; the quantities are then null and only the percent is shown
 * (review N4). The percent stays below 100 until the stage is complete (`completedStageIds`), as in the progress matrix,
 * where only the tick completes a stage (review M2).
 */
export function stageProgressOf(
  schedules: unknown,
  liveQuantities: ReadonlyMap<number, number>,
  completedStageIds: ReadonlySet<number> = new Set(),
): WorkshopStageProgress[] {
  const byStage = new Map<number, Array<{ unit: string; planned: number; done: number }>>();
  for (const row of workshopScheduleRows(schedules)) {
    byStage.set(row.stageId, [...(byStage.get(row.stageId) ?? []), { unit: row.unit, planned: row.quantity, done: scheduleRowDoneQuantity(row, liveQuantities) }]);
  }
  return [...byStage.entries()].sort((a, b) => a[0] - b[0]).flatMap(([stageId, rows]) => {
    const work = workProgressOf(rows);
    if (!work) return [];
    const percent = completedStageIds.has(stageId) ? workPercent(work.share) : Math.min(99, workPercent(work.share));
    return [{ stageId, plannedQuantity: work.planned, approvedQuantity: work.done, unit: work.unit, percent }];
  });
}

/** Quantities of the live work logs of this project among `logIds` (log id → quantity). */
export async function liveLogQuantities(executor: DbExecutor, projectId: number, logIds: number[]): Promise<Map<number, number>> {
  const ids = [...new Set(logIds)];
  if (ids.length === 0) return new Map();
  const rows = await executor.select({ id: pieceworkLogs.id, quantity: pieceworkLogs.quantity }).from(pieceworkLogs)
    .where(and(inArray(pieceworkLogs.id, ids), eq(pieceworkLogs.isDeleted, 0), eq(pieceworkLogs.projectId, projectId)));
  return new Map(rows.map(r => [r.id, Number(r.quantity)]));
}

/** The project schedule tab's view: pending reports (reviewers only) and each stage's approved share. */
export async function projectWorkshopReports(executor: DbExecutor, user: WorkshopUser, projectId: number, canReviewKey: boolean): Promise<ProjectWorkshopReports> {
  const [project] = await executor.select({ id: productionProjects.id, stageSchedules: productionProjects.stageSchedules }).from(productionProjects)
    .where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)));
  if (!project) return { pending: [], stageProgress: [], canReview: false };
  const scope = canReviewKey ? await reviewableProjectIds(executor, user) : [];
  const canReview = canReviewKey && (scope === null || scope.includes(projectId));
  const logIds = workshopScheduleRows(project.stageSchedules).map(r => r.pieceworkLogId).filter((id): id is number => id !== null);
  const completed = await executor.select({ id: projectStages.id }).from(projectStages)
    .where(and(eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0), eq(projectStages.status, 'completed')));
  return {
    pending: canReview ? await listReviewReports(executor, user, projectId) : [],
    stageProgress: stageProgressOf(project.stageSchedules, await liveLogQuantities(executor, projectId, logIds), new Set(completed.map(s => s.id))),
    canReview,
  };
}
