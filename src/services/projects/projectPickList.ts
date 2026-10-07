import { and, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { productionProjects } from '../../db/schema.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import type { ProjectPick } from '../../lib/permissions/pickLists.js';

/**
 * v9.0.139 (TD-889، تصمیم ت۱۰ الف مدل مجوز): فهرست انتخاب پروژه (`GET /projects/options`) برای فرم‌های بخش‌های دیگر
 * (سند ورود و خروج انبار، انبار پروژه، کارکرد کارمزدی، گزارش روزانه و تخصیص مواد اولیه). فقط فیلدهای
 * `PROJECT_PICK_FIELDS`؛ فهرست کامل (`GET /projects`، با محصولات، کنترل موجودی، مراحل و پیوست‌ها) فقط با `projects.view`.
 */

export interface ProjectPickListQuery {
  status?: string;
  search?: string;
  /** بی سقف وقتی نیامده یا صفر است */
  limit?: number;
}

export async function listProjectPicks(query: ProjectPickListQuery): Promise<ProjectPick[]> {
  const conditions: SQL[] = [eq(productionProjects.isDeleted, 0)];
  if (query.status && query.status !== 'all') conditions.push(eq(productionProjects.status, query.status));
  if (query.search) {
    const pattern = containsLikePattern(query.search);
    conditions.push(or(
      ilike(productionProjects.projectCode, pattern),
      ilike(productionProjects.title, pattern),
      ilike(productionProjects.customerName, pattern),
    ) as SQL);
  }
  const base = orm.select({
    id: productionProjects.id,
    projectCode: productionProjects.projectCode,
    title: productionProjects.title,
    status: productionProjects.status,
    customerName: productionProjects.customerName,
  }).from(productionProjects)
    .where(and(...conditions))
    .orderBy(desc(productionProjects.createdAt), desc(productionProjects.id))
    .$dynamic();
  const rows = query.limit && query.limit > 0 ? await base.limit(query.limit) : await base;

  return rows.map(row => {
    const projectCode = row.projectCode ?? '';
    const customerName = row.customerName ?? '';
    const status = row.status || 'planned';
    return {
      id: row.id,
      projectCode,
      project_code: projectCode,
      title: row.title ?? '',
      status,
      customerName,
      customer_name: customerName,
    };
  });
}
