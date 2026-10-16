import { and, asc, eq, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/drizzle.js';
import { personnel, pieceworkLogs, productionProjects, projectProductStageProgress, projectStages, workshopTaskReports } from '../../db/schema.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import type { MatrixTickSuggestion, WorkshopApproveResult, WorkshopReportView } from '../../lib/workshop/workshopContract.js';
import {
  reportQuantityError, WORKSHOP_ERRORS, WORKSHOP_NOTE_MAX, WORKSHOP_REPORT_STATUS_LABELS, workshopScheduleRows,
  type WorkshopReportStatus, type WorkshopScheduleRow,
} from '../../lib/workshop/workshopSchedule.js';
import { formatPersianNumber, toPersianDigits } from '../../utils/persianNumber.js';
import { PieceworkService } from '../piecework.service.js';
import { assertProjectReviewer, liveUserIds, notifyUsers, projectManagerUserIds, requireLinkedPersonnel, type WorkshopActor } from './workshopAccess.js';
import { CLOSED_PROJECT_STATUSES, liveLogIds, manualWorkLogs, productItemIdOf, productNameOf, reportView, rowHasLiveLog } from './workshopTasks.js';

/**
 * v10.1.39 (N-01 part 2, plan §4.3, decisions ت۲ الف, ت۵ الف, ت۶ الف and ت۷ الف): a worker's end-of-task report.
 * - The worker reports the final quantity of a schedule row assigned to them (at most the row's quantity, the TD-955
 *   rule); the project's managers are notified. Before review the worker edits or withdraws it.
 * - A manager approves it (the quantity may be corrected) in one transaction that writes the work log through
 *   `PieceworkService.logWorkEntries` with the row's `scheduleRef` (server rate, project row lock, one log per row,
 *   TD-735 / TD-736 / TD-921 / TD-955 / TD-956), or rejects it with a reason; the worker is notified either way.
 * - Each row has at most one live (submitted or approved) report (`uq_workshop_task_reports_live_row`).
 * Every write has its «گزارش کار کارگاه» audit row in its own transaction.
 */

const REVIEW_LINK = '/workshop/review';
const WORKER_LINK = '/workshop';

type ReportRow = typeof workshopTaskReports.$inferSelect;
type LockedProject = { id: number; projectCode: string; title: string; status: string | null; stageSchedules: unknown; products: unknown };

const fail = (e: { code: string; message: string }, details?: unknown) => new ValidationError(e.message, details, e.code);
const conflict = (e: { code: string; message: string }, details?: unknown) => new ConflictError(e.message, details, e.code);
const qty = (n: number) => formatPersianNumber(n, 4);

function auditFields(actor: WorkshopActor) {
  return { req: actor.req as never, userId: actor.user.id, username: actor.user.username, userFullName: actor.user.fullName };
}

function snapshot(r: ReportRow) {
  return {
    status: WORKSHOP_REPORT_STATUS_LABELS[r.status as WorkshopReportStatus] ?? r.status,
    quantity: Number(r.quantity),
    approvedQuantity: r.approvedQuantity === null ? null : Number(r.approvedQuantity),
    notes: r.notes,
    reviewNote: r.reviewNote,
    pieceworkLogId: r.pieceworkLogId,
  };
}

async function audit(tx: DbTransaction, actor: WorkshopActor, action: 'CREATE' | 'UPDATE', report: ReportRow, description: string, before: ReportRow | null): Promise<void> {
  await logActivity({
    ...auditFields(actor),
    tx,
    action: action === 'CREATE' ? 'CREATE' : 'UPDATE',
    entity: 'گزارش کار کارگاه',
    entityId: String(report.id),
    description,
    details: {
      projectId: report.projectId,
      stageId: report.stageId,
      productId: report.productId,
      rowId: report.rowId,
      personnelId: report.personnelId,
      ...(before ? { before: snapshot(before) } : {}),
      after: snapshot(report),
    },
  });
}

/** Locks the project row (`FOR SHARE` for a worker's report, `FOR UPDATE` for a review) and refuses a closed project. */
async function lockOpenProject(tx: DbTransaction, projectId: number, mode: 'share' | 'update'): Promise<LockedProject> {
  const query = tx.select({
    id: productionProjects.id, projectCode: productionProjects.projectCode, title: productionProjects.title, status: productionProjects.status,
    stageSchedules: productionProjects.stageSchedules, products: productionProjects.products,
  }).from(productionProjects).where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)));
  const [project] = await query.for(mode);
  if (!project) throw fail(WORKSHOP_ERRORS.rowNotFound);
  if (project.status && CLOSED_PROJECT_STATUSES.includes(project.status)) throw fail(WORKSHOP_ERRORS.projectClosed);
  return project;
}

function scheduleRowOf(project: LockedProject, ref: { stageId: number; productId: string; rowId: string }): WorkshopScheduleRow | null {
  return workshopScheduleRows(project.stageSchedules).find(r => r.stageId === ref.stageId && r.productId === ref.productId && r.rowId === ref.rowId) ?? null;
}

async function assertRowOpen(tx: DbTransaction, row: WorkshopScheduleRow): Promise<void> {
  const live = await liveLogIds(tx, row.pieceworkLogId ? [row.pieceworkLogId] : []);
  if (rowHasLiveLog(row, live)) throw conflict(WORKSHOP_ERRORS.rowLogged);
}

function assertQuantity(quantity: number, planned: number): void {
  const error = reportQuantityError(quantity, planned);
  if (error) throw fail(error, { quantity, plannedQuantity: planned });
}

const cleanNote = (raw: unknown) => String(raw ?? '').trim().slice(0, WORKSHOP_NOTE_MAX);

function rowLabel(project: LockedProject, row: WorkshopScheduleRow): string {
  const product = productNameOf(project.products, row);
  return `«${row.taskTitle || 'کار'}»${product ? ` برای ${product}` : ''} در پروژه ${project.projectCode} (${project.title})`;
}

export interface SubmitReportInput {
  projectId: number;
  stageId: number;
  productId: string;
  rowId: string;
  quantity: number;
  notes?: string;
}

/** «پایان کار و ثبت تعداد» by the worker the row is assigned to. */
export async function submitWorkshopReport(tx: DbTransaction, actor: WorkshopActor, input: SubmitReportInput): Promise<WorkshopReportView> {
  const me = await requireLinkedPersonnel(tx, actor.user.id, true);
  const project = await lockOpenProject(tx, input.projectId, 'share');
  const row = scheduleRowOf(project, input);
  if (!row || row.personnelId !== me.id) throw fail(WORKSHOP_ERRORS.rowNotFound);
  if (row.taskId === null) throw fail(WORKSHOP_ERRORS.rowNoTask);
  await assertRowOpen(tx, row);
  assertQuantity(input.quantity, row.quantity);

  const [inserted] = await tx.insert(workshopTaskReports).values({
    projectId: project.id,
    stageId: row.stageId,
    productId: row.productId,
    rowId: row.rowId,
    personnelId: me.id,
    taskId: row.taskId,
    quantity: input.quantity,
    notes: cleanNote(input.notes),
    status: 'submitted',
    createdById: actor.user.id,
  }).onConflictDoNothing().returning();
  if (!inserted) throw conflict(WORKSHOP_ERRORS.reportExists);

  await notifyUsers(tx, await projectManagerUserIds(tx, project.id), actor.user, {
    type: 'workshop_report_submitted',
    title: 'گزارش پایان کار تازه',
    message: `${me.fullName} پایان ${rowLabel(project, row)} را با تعداد ${qty(input.quantity)} گزارش کرد.`,
    link: REVIEW_LINK,
  });
  await audit(tx, actor, 'CREATE', inserted, `ثبت گزارش پایان کار ${rowLabel(project, row)}`, null);
  return reportView(inserted);
}

/** Locks a report row; the caller checks who may act on it. */
async function lockReport(tx: DbTransaction, reportId: number): Promise<ReportRow> {
  const [report] = await tx.select().from(workshopTaskReports).where(eq(workshopTaskReports.id, reportId)).for('update');
  if (!report) throw new NotFoundError(WORKSHOP_ERRORS.reportNotFound.message, undefined, WORKSHOP_ERRORS.reportNotFound.code);
  return report;
}

function assertSubmittedAt(report: ReportRow, version: number): void {
  if (report.status !== 'submitted') throw conflict(WORKSHOP_ERRORS.reportNotSubmitted, { status: report.status });
  if (report.version !== version) throw conflict(WORKSHOP_ERRORS.reportStale, { version: report.version });
}

/** The worker's own submitted report; another personnel's report is «not found». */
async function lockOwnReport(tx: DbTransaction, actor: WorkshopActor, reportId: number, version: number): Promise<ReportRow> {
  const me = await requireLinkedPersonnel(tx, actor.user.id, true);
  const [peek] = await tx.select({ projectId: workshopTaskReports.projectId }).from(workshopTaskReports).where(eq(workshopTaskReports.id, reportId));
  if (peek) await tx.select({ id: productionProjects.id }).from(productionProjects).where(eq(productionProjects.id, peek.projectId)).for('share');
  const report = await lockReport(tx, reportId);
  if (report.personnelId !== me.id) throw new NotFoundError(WORKSHOP_ERRORS.reportNotFound.message, undefined, WORKSHOP_ERRORS.reportNotFound.code);
  assertSubmittedAt(report, version);
  return report;
}

export async function editWorkshopReport(tx: DbTransaction, actor: WorkshopActor, reportId: number, input: { version: number; quantity?: number; notes?: string }): Promise<WorkshopReportView> {
  const report = await lockOwnReport(tx, actor, reportId, input.version);
  const project = await lockOpenProject(tx, report.projectId, 'share');
  // the row must still be in the saved schedule, assigned to the worker, with the task the report names and a quantity
  const row = scheduleRowOf(project, report);
  if (!row || row.personnelId !== report.personnelId) throw fail(WORKSHOP_ERRORS.rowNotFound);
  if (row.taskId !== report.taskId) throw conflict(WORKSHOP_ERRORS.rowTaskChanged);
  const quantity = input.quantity ?? Number(report.quantity);
  assertQuantity(quantity, row.quantity);
  const [updated] = await tx.update(workshopTaskReports).set({
    quantity,
    notes: input.notes === undefined ? report.notes : cleanNote(input.notes),
    updatedAt: sql`now()`,
    version: report.version + 1,
  }).where(eq(workshopTaskReports.id, report.id)).returning();
  await audit(tx, actor, 'UPDATE', updated, `اصلاح گزارش پایان کار شماره ${toPersianDigits(report.id)}`, report);
  return reportView(updated);
}

export async function withdrawWorkshopReport(tx: DbTransaction, actor: WorkshopActor, reportId: number, version: number): Promise<WorkshopReportView> {
  const report = await lockOwnReport(tx, actor, reportId, version);
  const [updated] = await tx.update(workshopTaskReports).set({
    status: 'withdrawn', updatedAt: sql`now()`, version: report.version + 1,
  }).where(eq(workshopTaskReports.id, report.id)).returning();
  await audit(tx, actor, 'UPDATE', updated, `پس گرفتن گزارش پایان کار شماره ${toPersianDigits(report.id)}`, report);
  return reportView(updated);
}

/** Locks the report's project `FOR UPDATE`, then the report, and checks the reviewer and the version. */
async function lockForReview(tx: DbTransaction, actor: WorkshopActor, reportId: number, version: number): Promise<{ report: ReportRow; project: LockedProject | null }> {
  const [peek] = await tx.select({ projectId: workshopTaskReports.projectId }).from(workshopTaskReports).where(eq(workshopTaskReports.id, reportId));
  if (!peek) throw new NotFoundError(WORKSHOP_ERRORS.reportNotFound.message, undefined, WORKSHOP_ERRORS.reportNotFound.code);
  await assertProjectReviewer(tx, actor.user, peek.projectId);
  const [project] = await tx.select({
    id: productionProjects.id, projectCode: productionProjects.projectCode, title: productionProjects.title, status: productionProjects.status,
    stageSchedules: productionProjects.stageSchedules, products: productionProjects.products,
  }).from(productionProjects).where(and(eq(productionProjects.id, peek.projectId), eq(productionProjects.isDeleted, 0))).for('update');
  const report = await lockReport(tx, reportId);
  await assertNotOwnReport(tx, actor.user, report);
  assertSubmittedAt(report, version);
  return { report, project: project ?? null };
}

/**
 * A reviewer never approves or rejects a report of their own work (its personnel is linked to them, or they recorded it),
 * since the approval writes the work log they are paid for; the system admin is exempt, as in the payroll duties.
 */
async function assertNotOwnReport(tx: DbTransaction, user: WorkshopActor['user'], report: ReportRow): Promise<void> {
  if (user.isAdmin) return;
  const [worker] = await tx.select({ userId: personnel.userId }).from(personnel).where(eq(personnel.id, report.personnelId));
  if (worker?.userId === user.id || report.createdById === user.id) {
    throw new ForbiddenError(WORKSHOP_ERRORS.ownReport.message, undefined, WORKSHOP_ERRORS.ownReport.code);
  }
}

async function workerUserIds(tx: DbTransaction, personnelId: number): Promise<number[]> {
  const [row] = await tx.select({ userId: personnel.userId }).from(personnel).where(eq(personnel.id, personnelId));
  return liveUserIds(tx, row?.userId ? [row.userId] : []);
}

export interface ApproveReportInput {
  version: number;
  /** the corrected quantity; empty keeps the reported one */
  quantity?: number;
  /** the work log's ISO date; empty is the business today */
  date?: string;
  note?: string;
  /** «بررسی کردم»: the reviewer has seen the manual work logs of the same worker, task and project */
  acknowledgeManualLogs?: boolean;
}

/** «تأیید»: writes the row's work log through the piecework path and marks the report approved, in one transaction. */
export async function approveWorkshopReport(tx: DbTransaction, actor: WorkshopActor, reportId: number, input: ApproveReportInput): Promise<WorkshopApproveResult> {
  const { report, project } = await lockForReview(tx, actor, reportId, input.version);
  if (!project || (project.status && CLOSED_PROJECT_STATUSES.includes(project.status))) throw fail(WORKSHOP_ERRORS.projectClosed);
  const row = scheduleRowOf(project, report);
  if (!row || row.personnelId !== report.personnelId) throw fail(WORKSHOP_ERRORS.rowNotFound);
  if (row.taskId === null) throw fail(WORKSHOP_ERRORS.rowNoTask);
  // the work log takes the row's current task; a report made for another task is rejected and sent again, never paid at another rate
  if (row.taskId !== report.taskId) throw conflict(WORKSHOP_ERRORS.rowTaskChanged, { reportTaskId: report.taskId, rowTaskId: row.taskId });
  await assertRowOpen(tx, row);
  const quantity = input.quantity ?? Number(report.quantity);
  assertQuantity(quantity, row.quantity);
  const reviewNote = cleanNote(input.note);
  const manual = (await manualWorkLogs(tx, [project], [{ projectId: project.id, personnelId: report.personnelId, taskId: row.taskId }]))
    .get(`${project.id}|${report.personnelId}|${row.taskId}`) ?? [];
  if (manual.length > 0 && input.acknowledgeManualLogs !== true) throw conflict(WORKSHOP_ERRORS.manualLogsExist, { manualLogs: manual });

  const [logId] = await PieceworkService.logWorkEntries([{
    personnelId: report.personnelId,
    taskId: row.taskId,
    projectId: project.id,
    date: input.date || await businessTodayIsoDate(),
    quantity,
    notes: `گزارش کارگاه شماره ${toPersianDigits(report.id)}${reviewNote ? ` — ${reviewNote}` : ''}`,
    scheduleRef: { stageId: row.stageId, productId: row.productId, rowId: row.rowId },
    createdById: actor.user.id,
    createdByUsername: actor.user.username || 'سیستم',
  }], tx, { req: actor.req, userId: actor.user.id, username: actor.user.username });

  const [updated] = await tx.update(workshopTaskReports).set({
    status: 'approved',
    approvedQuantity: quantity,
    reviewNote,
    reviewedById: actor.user.id,
    reviewedAt: sql`now()`,
    pieceworkLogId: logId,
    updatedAt: sql`now()`,
    version: report.version + 1,
  }).where(eq(workshopTaskReports.id, report.id)).returning();

  const [log] = await tx.select({ totalAmount: pieceworkLogs.totalAmount }).from(pieceworkLogs).where(eq(pieceworkLogs.id, logId));
  const corrected = quantity !== Number(report.quantity) ? ` (تعداد گزارش‌شده ${qty(Number(report.quantity))}، تأییدشده ${qty(quantity)})` : '';
  await notifyUsers(tx, await workerUserIds(tx, report.personnelId), actor.user, {
    type: 'workshop_report_approved',
    title: 'گزارش کار شما تأیید شد',
    message: `گزارش پایان ${rowLabel(project, row)} تأیید شد${corrected}. مبلغ کارکرد: ${formatPersianNumber(log?.totalAmount.toNumber() ?? 0, 0)} ریال.`,
    link: WORKER_LINK,
  });
  await audit(tx, actor, 'UPDATE', updated, `تأیید گزارش پایان کار ${rowLabel(project, row)}`, report);

  return { reportId: report.id, pieceworkLogId: logId, matrixTickSuggestion: await matrixTickSuggestion(tx, project.id, row) };
}

/**
 * Decision ت۶ الف: once every row of the product in the stage has its work log, suggest ticking that cell of the
 * progress matrix, unless it is already completed. The tick itself stays the matrix's own route.
 */
async function matrixTickSuggestion(tx: DbTransaction, projectId: number, approvedRow: WorkshopScheduleRow): Promise<MatrixTickSuggestion | null> {
  const [project] = await tx.select({ stageSchedules: productionProjects.stageSchedules, products: productionProjects.products }).from(productionProjects)
    .where(eq(productionProjects.id, projectId));
  if (!project) return null;
  const siblings = workshopScheduleRows(project.stageSchedules).filter(r => r.stageId === approvedRow.stageId && r.productId === approvedRow.productId);
  const live = await liveLogIds(tx, siblings.map(r => r.pieceworkLogId).filter((id): id is number => id !== null));
  if (siblings.length === 0 || !siblings.every(r => rowHasLiveLog(r, live))) return null;
  const [stage] = await tx.select({ title: projectStages.title, stageOrder: projectStages.stageOrder }).from(projectStages)
    .where(and(eq(projectStages.id, approvedRow.stageId), eq(projectStages.isDeleted, 0)));
  if (!stage) return null;
  const itemId = productItemIdOf(project.products, approvedRow.productId);
  if (itemId !== null) {
    const done = await tx.select({ id: projectProductStageProgress.id }).from(projectProductStageProgress)
      .where(and(
        eq(projectProductStageProgress.projectId, projectId), eq(projectProductStageProgress.itemId, itemId),
        eq(projectProductStageProgress.stageOrder, stage.stageOrder), eq(projectProductStageProgress.status, 'completed'),
        eq(projectProductStageProgress.isDeleted, 0),
      )).orderBy(asc(projectProductStageProgress.id)).limit(1);
    if (done.length > 0) return null;
  }
  return {
    projectId,
    stageId: approvedRow.stageId,
    stageOrder: stage.stageOrder,
    stageTitle: stage.title,
    productId: approvedRow.productId,
    productName: productNameOf(project.products, approvedRow),
    itemId,
  };
}

/** «رد» with a required reason; the row becomes reportable again. */
export async function rejectWorkshopReport(tx: DbTransaction, actor: WorkshopActor, reportId: number, input: { version: number; reason: string }): Promise<WorkshopReportView> {
  const reason = cleanNote(input.reason);
  if (!reason) throw fail(WORKSHOP_ERRORS.rejectReasonRequired);
  const { report, project } = await lockForReview(tx, actor, reportId, input.version);
  const [updated] = await tx.update(workshopTaskReports).set({
    status: 'rejected',
    reviewNote: reason,
    reviewedById: actor.user.id,
    reviewedAt: sql`now()`,
    updatedAt: sql`now()`,
    version: report.version + 1,
  }).where(eq(workshopTaskReports.id, report.id)).returning();
  const row = project ? scheduleRowOf(project, report) : null;
  const label = project && row ? rowLabel(project, row) : `شماره ${toPersianDigits(report.id)}`;
  await notifyUsers(tx, await workerUserIds(tx, report.personnelId), actor.user, {
    type: 'workshop_report_rejected',
    title: 'گزارش کار شما رد شد',
    message: `گزارش پایان ${label} رد شد. دلیل: ${reason}`,
    link: WORKER_LINK,
  });
  await audit(tx, actor, 'UPDATE', updated, `رد گزارش پایان کار ${label}`, report);
  return reportView(updated);
}
