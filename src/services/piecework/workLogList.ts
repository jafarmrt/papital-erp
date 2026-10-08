import { and, desc, eq, ilike, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { pieceworkLogs, pieceworkTasks, personnel, productionProjects } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { requireStorageDate } from '../../lib/storageDate.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import type { WorkLogListFilters, WorkLogPage, WorkLogSummary } from '../../lib/piecework/workLogList.js';

/**
 * v9.0.330 (TD-811، B12P-08): فهرست کارکرد با فیلتر، صفحه‌بندی و جمع در SQL. پیش‌تر کل جدول با سه join خوانده و در
 * جاوااسکریپت فیلتر می‌شد (فیلتر پرسنل هم کل جدول را می‌خواند: ۲٬۰۰۰ ردیف در ۱٬۰۷۹ میلی‌ثانیه از ۶۰٬۰۰۰).
 */

const isAll = (v: unknown) => v === undefined || v === null || v === '' || String(v).toLowerCase() === 'all';

function workLogConditions(filters: WorkLogListFilters): SQL[] {
  const conditions: SQL[] = [eq(pieceworkLogs.isDeleted, 0)];
  if (!isAll(filters.personnelId)) conditions.push(eq(pieceworkLogs.personnelId, Number(filters.personnelId)));
  if (String(filters.projectId ?? '').toLowerCase() === 'none') conditions.push(isNull(pieceworkLogs.projectId));
  else if (!isAll(filters.projectId)) conditions.push(eq(pieceworkLogs.projectId, Number(filters.projectId)));
  const status = String(filters.status ?? '').toLowerCase();
  // «تسویه‌شده» هر کارکردی است که در فیش آمده؛ پیش‌تر صفحه وضعیت «processed» را با وضعیت ردیف می‌سنجید و هیچ ردیفی نمی‌آمد
  if (status === 'processed') conditions.push(ne(pieceworkLogs.status, 'pending'));
  else if (!isAll(status)) conditions.push(eq(pieceworkLogs.status, status));
  // v7.0.134 (TD-232): تاریخ کارکرد میلادی ISO است؛ بازه شمسی ورودی ISO می‌شود
  const startIso = requireStorageDate(filters.startDate, 'از تاریخ');
  const endIso = requireStorageDate(filters.endDate, 'تا تاریخ');
  if (startIso) conditions.push(sql`${pieceworkLogs.date} >= ${startIso}::text`);
  if (endIso) conditions.push(sql`${pieceworkLogs.date} <= ${endIso}::text`);
  const search = String(filters.search ?? '').trim();
  if (search) {
    const pattern = containsLikePattern(search);
    const matches = or(ilike(personnel.fullName, pattern), ilike(pieceworkTasks.title, pattern), ilike(productionProjects.title, pattern));
    if (matches) conditions.push(matches);
  }
  return conditions;
}

function selectWorkLogs() {
  return orm.select({
    id: pieceworkLogs.id,
    personnelId: pieceworkLogs.personnelId,
    personnelName: personnel.fullName,
    personnelCode: personnel.personnelCode,
    taskId: pieceworkLogs.taskId,
    taskTitle: pieceworkTasks.title,
    taskCode: pieceworkTasks.code,
    taskCategory: pieceworkTasks.category,
    unit: pieceworkTasks.unit,
    projectId: pieceworkLogs.projectId,
    projectCode: productionProjects.projectCode,
    projectTitle: productionProjects.title,
    date: pieceworkLogs.date,
    dateIso: pieceworkLogs.dateIso,
    quantity: pieceworkLogs.quantity,
    unitRate: pieceworkLogs.unitRate,
    totalAmount: pieceworkLogs.totalAmount,
    notes: pieceworkLogs.notes,
    payrollId: pieceworkLogs.payrollId,
    status: pieceworkLogs.status,
    createdById: pieceworkLogs.createdById,
    createdByUsername: pieceworkLogs.createdByUsername,
    createdAt: pieceworkLogs.createdAt
  })
  .from(pieceworkLogs)
  .innerJoin(personnel, eq(pieceworkLogs.personnelId, personnel.id))
  .innerJoin(pieceworkTasks, eq(pieceworkLogs.taskId, pieceworkTasks.id))
  .leftJoin(productionProjects, eq(pieceworkLogs.projectId, productionProjects.id));
}

export type WorkLogRow = Awaited<ReturnType<typeof listWorkLogs>>[number];

/** همه کارکردهای منطبق (پیش‌نمایش صدور فیش یک پرسنل در یک بازه، کارکردهای یک پروژه) */
export async function listWorkLogs(filters: WorkLogListFilters) {
  return selectWorkLogs()
    .where(and(...workLogConditions(filters)))
    .orderBy(desc(pieceworkLogs.date), desc(pieceworkLogs.id));
}

/** یک صفحه از کارکردهای منطبق با شمار و جمع مبلغ همه منطبق‌ها */
export async function pageWorkLogs(filters: WorkLogListFilters, page: number, limit: number): Promise<WorkLogPage<WorkLogRow>> {
  const where = and(...workLogConditions(filters));
  const [totals] = await orm.select({ total: sql<number>`COUNT(*)::int`, amount: sql<string>`COALESCE(SUM(${pieceworkLogs.totalAmount}), 0)::text` })
    .from(pieceworkLogs)
    .innerJoin(personnel, eq(pieceworkLogs.personnelId, personnel.id))
    .innerJoin(pieceworkTasks, eq(pieceworkLogs.taskId, pieceworkTasks.id))
    .leftJoin(productionProjects, eq(pieceworkLogs.projectId, productionProjects.id))
    .where(where);
  const data = await selectWorkLogs()
    .where(where)
    .orderBy(desc(pieceworkLogs.date), desc(pieceworkLogs.id))
    .limit(limit)
    .offset((page - 1) * limit);
  return { data, total: Number(totals?.total ?? 0), page, limit, totalAmount: fin(totals?.amount ?? 0).toNumber() };
}

/** کارت‌های صفحه و «هزینه پروژه‌ها»: جمع SQL روی همه کارکردهای زنده، همان ردیف‌هایی که فهرست نشان می‌دهد */
export async function workLogSummary(): Promise<WorkLogSummary> {
  const live = eq(pieceworkLogs.isDeleted, 0);
  const [totals] = await orm.select({
    logCount: sql<number>`COUNT(*)::int`,
    totalAmount: sql<string>`COALESCE(SUM(${pieceworkLogs.totalAmount}), 0)::text`,
    pendingAmount: sql<string>`COALESCE(SUM(${pieceworkLogs.totalAmount}) FILTER (WHERE ${pieceworkLogs.status} = 'pending'), 0)::text`,
  })
    .from(pieceworkLogs)
    .innerJoin(personnel, eq(pieceworkLogs.personnelId, personnel.id))
    .innerJoin(pieceworkTasks, eq(pieceworkLogs.taskId, pieceworkTasks.id))
    .where(live);
  const projects = await orm.select({
    projectId: pieceworkLogs.projectId,
    projectTitle: productionProjects.title,
    totalCost: sql<string>`COALESCE(SUM(${pieceworkLogs.totalAmount}), 0)::text`,
    logCount: sql<number>`COUNT(*)::int`,
    personnelCount: sql<number>`COUNT(DISTINCT ${pieceworkLogs.personnelId})::int`,
  })
    .from(pieceworkLogs)
    .innerJoin(personnel, eq(pieceworkLogs.personnelId, personnel.id))
    .innerJoin(pieceworkTasks, eq(pieceworkLogs.taskId, pieceworkTasks.id))
    .leftJoin(productionProjects, eq(pieceworkLogs.projectId, productionProjects.id))
    .where(live)
    .groupBy(pieceworkLogs.projectId, productionProjects.title)
    .orderBy(sql`SUM(${pieceworkLogs.totalAmount}) DESC`);
  return {
    logCount: Number(totals?.logCount ?? 0),
    totalAmount: fin(totals?.totalAmount ?? 0).toNumber(),
    pendingAmount: fin(totals?.pendingAmount ?? 0).toNumber(),
    projects: projects.map(p => ({
      projectId: p.projectId ?? null,
      title: p.projectTitle || (p.projectId ? `پروژه #${p.projectId}` : 'بدون پروژه کارگاهی (عمومی)'),
      totalCost: fin(p.totalCost).toNumber(),
      logCount: Number(p.logCount),
      personnelCount: Number(p.personnelCount),
    })),
  };
}
