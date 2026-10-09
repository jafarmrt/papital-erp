import { inArray } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { productionProjects } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import type { HealthCheckTestResult } from '../../types.js';
import { formatPersianPrice, toPersianDigits } from '../../utils/persianNumber.js';
import { projectWipBalances } from './projectWipBalance.js';

/**
 * v10.0.25 (TD-919، تصمیم ت۴ ب فاز ۵): پروژه تکمیل‌شده، لغوشده یا حذف‌شده‌ای که هنوز مانده کالای در جریان ساخت (۱۴۰۲)
 * دارد. دستمزد هزینه دوره است و بهای تحویل فقط بهای مواد (TD-920)، پس پروژه بسته باید مانده صفر داشته باشد؛ مانده‌ای که
 * می‌ماند (تحویل بیش یا کم از مواد، تخصیص پیش از TD-412) با سند اصلاحی بسته می‌شود. ناوردایی I3 حساب ۱۴۰۲ را کنار
 * می‌گذارد، پس این مانده‌ها جایی جز این فهرست دیده نمی‌شوند. خودکار تغییر نمی‌کنند.
 */
export const CLOSED_PROJECT_STATUSES = ['completed', 'cancelled'];

export interface ClosedProjectWip {
  projectId: number;
  projectCode: string;
  title: string;
  state: 'completed' | 'cancelled' | 'deleted';
  balance: string;
}

export async function findClosedProjectWipBalances(db: DbExecutor = orm): Promise<ClosedProjectWip[]> {
  const balances = await projectWipBalances(db);
  if (balances.size === 0) return [];
  const projects = await db.select({ id: productionProjects.id, projectCode: productionProjects.projectCode, title: productionProjects.title, status: productionProjects.status, isDeleted: productionProjects.isDeleted })
    .from(productionProjects)
    .where(inArray(productionProjects.id, [...balances.keys()]));
  const found = new Map(projects.map(p => [p.id, p]));
  const result: ClosedProjectWip[] = [];
  for (const [projectId, balance] of [...balances.entries()].sort((a, b) => a[0] - b[0])) {
    const p = found.get(projectId);
    // ردیفی که پروژه‌اش هیچ‌گاه نبوده هم حذف‌شده شمرده می‌شود
    const state = !p || p.isDeleted === 1 ? 'deleted' : CLOSED_PROJECT_STATUSES.includes(String(p.status)) ? (p.status as 'completed' | 'cancelled') : null;
    if (!state) continue;
    result.push({ projectId, projectCode: p?.projectCode ?? '', title: p?.title ?? '', state, balance });
  }
  return result;
}

const STATE_LABELS: Record<ClosedProjectWip['state'], string> = { completed: 'تکمیل‌شده', cancelled: 'لغوشده', deleted: 'حذف‌شده' };

export function buildClosedProjectWipHealthTest(rows: ClosedProjectWip[]): HealthCheckTestResult {
  const count = rows.length;
  return {
    id: 'project_wip_closed_balance',
    category: 'accounts',
    title: 'مانده کالای در جریان ساخت پروژه بسته',
    description: 'پروژه تکمیل‌شده، لغوشده یا حذف‌شده نباید مانده کالای در جریان ساخت (۱۴۰۲) داشته باشد؛ دستمزد هزینه دوره است و بهای تحویل فقط بهای مواد. این مانده‌ها خودکار تغییر نمی‌کنند',
    status: count > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(5, count),
    count,
    message: count > 0
      ? `${toPersianDigits(count)} پروژه بسته یا حذف‌شده مانده کالای در جریان ساخت دارد؛ آن را با سند اصلاحی با تفصیلی همان پروژه ببندید.`
      : 'هیچ پروژه بسته یا حذف‌شده‌ای مانده کالای در جریان ساخت ندارد.',
    items: rows.map(r => ({
      id: r.projectId,
      code: r.projectCode || `پروژه #${toPersianDigits(r.projectId)}`,
      title: r.title || 'پروژه',
      subtitle: STATE_LABELS[r.state],
      details: `مانده ${formatPersianPrice(fin(r.balance).abs().toString(), 'IRR', 0)} ${fin(r.balance).isNegative() ? 'بستانکار' : 'بدهکار'} (TD-919).`,
    })),
    metrics: { closedProjectWipBalances: count },
  };
}
