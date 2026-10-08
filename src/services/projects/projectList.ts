import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { productionProjects, projectStages } from '../../db/schema.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import {
  PROJECT_LIST_PAGE_SIZE,
  projectStageProgress,
  type ProjectListPage,
  type ProjectListRow,
  type ProjectListStage,
  type ProjectStatusCounts,
} from '../../lib/projects/projectList.js';

/**
 * v9.0.388 (TD-743، B11-09): یک صفحه از فهرست پروژه‌های تولید (`GET /projects`). صافی‌ها، شمارش و صفحه‌بندی در SQL است و
 * مراحل فقط برای پروژه‌های همان صفحه خوانده می‌شوند؛ ردیف فقط فیلدهای `PROJECT_LIST_ROW_FIELDS` را دارد.
 */

export interface ProjectListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  priority?: string;
}

/** وضعیت خالی پروژه «برنامه‌ریزی‌شده» است، مانند پرونده پروژه */
const projectStatusSql = sql<string>`COALESCE(NULLIF(${productionProjects.status}, ''), 'planned')`;
const projectPrioritySql = sql<string>`COALESCE(NULLIF(${productionProjects.priority}, ''), 'medium')`;
const attachmentsCountSql = sql<number>`CASE WHEN jsonb_typeof(${productionProjects.attachments}) = 'array' THEN jsonb_array_length(${productionProjects.attachments}) ELSE 0 END`;

export async function listProjectPage(query: ProjectListQuery): Promise<ProjectListPage> {
  const page = query.page && query.page > 0 ? query.page : 1;
  const limit = query.limit && query.limit > 0 ? query.limit : PROJECT_LIST_PAGE_SIZE;

  const conditions: SQL[] = [eq(productionProjects.isDeleted, 0)];
  if (query.priority && query.priority !== 'all') conditions.push(eq(projectPrioritySql, query.priority));
  const search = query.search?.trim();
  if (search) {
    const pattern = containsLikePattern(search);
    conditions.push(or(
      ilike(productionProjects.projectCode, pattern),
      ilike(productionProjects.title, pattern),
      ilike(productionProjects.customerName, pattern),
      ilike(productionProjects.itemName, pattern),
      ilike(productionProjects.itemCode, pattern),
    ) as SQL);
  }
  const status = query.status && query.status !== 'all' ? query.status : null;

  const countRows = await orm
    .select({ status: projectStatusSql, n: count() })
    .from(productionProjects)
    .where(and(...conditions))
    .groupBy(projectStatusSql);
  const statusCounts: ProjectStatusCounts = {};
  for (const row of countRows) statusCounts[row.status] = Number(row.n) || 0;
  const total = status ? (statusCounts[status] ?? 0) : Object.values(statusCounts).reduce((sum, n) => sum + n, 0);

  const rows = await orm
    .select({
      id: productionProjects.id,
      projectCode: productionProjects.projectCode,
      title: productionProjects.title,
      customerName: productionProjects.customerName,
      itemCode: productionProjects.itemCode,
      itemName: productionProjects.itemName,
      quantity: productionProjects.quantity,
      unit: productionProjects.unit,
      startDate: productionProjects.startDate,
      endDate: productionProjects.endDate,
      status: projectStatusSql,
      priority: projectPrioritySql,
      attachmentsCount: attachmentsCountSql,
    })
    .from(productionProjects)
    .where(and(...conditions, ...(status ? [eq(projectStatusSql, status)] : [])))
    .orderBy(desc(productionProjects.createdAt), desc(productionProjects.id))
    .limit(limit)
    .offset((page - 1) * limit);

  const ids = rows.map(r => r.id);
  const stageRows = ids.length === 0 ? [] : await orm
    .select({
      id: projectStages.id,
      projectId: projectStages.projectId,
      title: projectStages.title,
      stageOrder: projectStages.stageOrder,
      status: projectStages.status,
      progressPercent: projectStages.progressPercent,
    })
    .from(projectStages)
    .where(and(inArray(projectStages.projectId, ids), eq(projectStages.isDeleted, 0)))
    .orderBy(asc(projectStages.stageOrder), asc(projectStages.id));
  const stagesByProject = new Map<number, typeof stageRows>();
  for (const stage of stageRows) {
    const list = stagesByProject.get(stage.projectId) ?? [];
    list.push(stage);
    stagesByProject.set(stage.projectId, list);
  }

  const data = rows.map((row): ProjectListRow => {
    const stages = stagesByProject.get(row.id) ?? [];
    const progress = projectStageProgress(stages);
    return {
      id: row.id,
      project_code: row.projectCode ?? '',
      title: row.title ?? '',
      customer_name: row.customerName ?? '',
      item_code: row.itemCode ?? '',
      item_name: row.itemName ?? '',
      quantity: Number(row.quantity) || 0,
      unit: row.unit || 'عدد',
      start_date: row.startDate ?? '',
      end_date: row.endDate ?? '',
      status: row.status,
      priority: row.priority,
      progress_percent: progress.progressPercent,
      total_stages: progress.totalStages,
      completed_stages: progress.completedStages,
      attachments_count: Number(row.attachmentsCount) || 0,
      stages: stages.map((s): ProjectListStage => ({
        id: s.id,
        title: s.title,
        stage_order: s.stageOrder,
        status: s.status || 'pending',
        progress_percent: s.progressPercent ?? 0,
      })),
    };
  });

  return { data, total, page, limit, statusCounts };
}
