import { sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import type { HealthCheckTestResult } from '../../types.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v9.0.367 (TD-737، TD-753): یکتایی شماره مرحله زنده هر پروژه و کلید خارجی مرحله به پروژه (مهاجرت 0084). مهاجرت ایندکس
 * یکتا را فقط روی داده بی تکرار می‌سازد و کلید خارجی را NOT VALID می‌افزاید و فقط وقتی مرحله‌ای به پروژه ناموجود اشاره نکند
 * اعتبارسنجی می‌کند؛ ردیف‌های قدیمی دست نمی‌خورند و آنچه مانده این‌جا فهرست می‌شود.
 */
export const PROJECT_STAGE_ORDER_INDEX = 'uq_project_stages_order_active';
export const PROJECT_STAGE_PROJECT_FK = 'fk_project_stages_project';

export interface DuplicateStageOrder {
  projectId: number;
  projectCode: string;
  stageOrder: number;
  stageIds: number[];
}

export interface ProjectStageIntegrity {
  duplicateOrders: DuplicateStageOrder[];
  orderIndexPresent: boolean;
  foreignKeyState: 'valid' | 'not_valid' | 'missing';
  orphanStages: number;
}

type Row = Record<string, unknown>;
const rowsOf = (res: { rows?: unknown[] }): Row[] => (Array.isArray(res.rows) ? (res.rows as Row[]) : []);

export async function findProjectStageIntegrity(db: DbExecutor = orm): Promise<ProjectStageIntegrity> {
  const duplicateOrders = rowsOf(await db.execute(sql`
    SELECT s.project_id, COALESCE(p.project_code, '') AS project_code, s.stage_order, array_agg(s.id ORDER BY s.id) AS ids
    FROM project_stages s LEFT JOIN production_projects p ON p.id = s.project_id
    WHERE s.is_deleted = 0
    GROUP BY s.project_id, p.project_code, s.stage_order
    HAVING count(*) > 1
    ORDER BY s.project_id, s.stage_order
  `)).map(r => ({
    projectId: Number(r.project_id),
    projectCode: String(r.project_code ?? ''),
    stageOrder: Number(r.stage_order),
    stageIds: (Array.isArray(r.ids) ? r.ids : []).map(Number),
  }));
  const [state] = rowsOf(await db.execute(sql`
    SELECT to_regclass(${PROJECT_STAGE_ORDER_INDEX}) IS NOT NULL AS index_present,
      (SELECT c.convalidated FROM pg_constraint c WHERE c.conname = ${PROJECT_STAGE_PROJECT_FK} AND c.conrelid = to_regclass('project_stages')) AS fk_valid,
      (SELECT count(*)::int FROM project_stages s WHERE NOT EXISTS (SELECT 1 FROM production_projects p WHERE p.id = s.project_id)) AS orphans
  `));
  const fkValid = state?.fk_valid;
  return {
    duplicateOrders,
    orderIndexPresent: Boolean(state?.index_present),
    foreignKeyState: fkValid === true ? 'valid' : fkValid === false ? 'not_valid' : 'missing',
    orphanStages: Number(state?.orphans) || 0,
  };
}

export function buildProjectStageHealthTest(integrity: ProjectStageIntegrity): HealthCheckTestResult {
  const { duplicateOrders, orderIndexPresent, foreignKeyState, orphanStages } = integrity;
  const count = duplicateOrders.length + orphanStages;
  const constraintsMissing = !orderIndexPresent || foreignKeyState !== 'valid';
  const notes: string[] = [];
  if (duplicateOrders.length > 0) notes.push(`${toPersianDigits(duplicateOrders.length)} شماره مرحله زنده در یک پروژه تکراری است`);
  if (orphanStages > 0) notes.push(`${toPersianDigits(orphanStages)} مرحله به پروژه‌ای ناموجود اشاره می‌کند`);
  if (!orderIndexPresent) notes.push('قید یکتایی شماره مرحله در پایگاه‌داده اعمال نشده است');
  if (foreignKeyState !== 'valid') notes.push('کلید خارجی مرحله به پروژه اعتبارسنجی نشده است');
  return {
    id: 'project_stage_integrity',
    category: 'system',
    title: 'یکتایی شماره مرحله پروژه',
    description: 'هر پروژه برای هر شماره یک مرحله زنده دارد و هر مرحله به پروژه‌ای موجود اشاره می‌کند. پیش از نسخه ۹.۰.۳۶۷ مرحله تازه شماره مرحله حذف‌شده را می‌گرفت و تیک‌های آن را به ارث می‌برد؛ این ردیف‌ها خودکار تغییر نمی‌کنند',
    status: count > 0 || constraintsMissing ? 'warning' : 'healthy',
    scoreImpact: -Math.min(10, count * 2),
    count,
    message: notes.length > 0
      ? `${notes.join('؛ ')}. مرحله تکراری را در صفحه پروژه حذف یا شماره‌اش را اصلاح کنید.`
      : 'شماره مراحل هر پروژه یکتاست، هر مرحله پروژه‌ای موجود دارد و پایگاه‌داده هر دو را نگه می‌دارد.',
    items: duplicateOrders.map(d => ({
      id: d.stageIds[d.stageIds.length - 1],
      code: d.projectCode || `پروژه #${toPersianDigits(d.projectId)}`,
      title: `مرحله شماره ${toPersianDigits(d.stageOrder)}`,
      subtitle: `${toPersianDigits(d.stageIds.length)} مرحله زنده با این شماره`,
      details: `شناسه مرحله‌ها: ${d.stageIds.map(id => toPersianDigits(id)).join('، ')} (TD-737).`,
    })),
    metrics: {
      duplicateStageOrders: duplicateOrders.length,
      orphanStages,
      orderIndexPresent: orderIndexPresent ? 1 : 0,
      projectForeignKeyValid: foreignKeyState === 'valid' ? 1 : 0,
    },
  };
}

export interface ProjectFreeTextValue {
  kind: 'project_status' | 'project_priority' | 'stage_status';
  id: number;
  projectId: number;
  projectCode: string;
  value: string;
}

/**
 * v9.0.380 (TD-754): پروژه و مرحله‌ای که پیش از فهرست‌های بسته وضعیت یا اولویتی بیرون از رابط گرفته‌اند (مثل «Completed»)؛
 * از همه پالایه‌های وضعیت بیرون می‌افتند. خودکار تغییر نمی‌کنند و فقط فهرست می‌شوند.
 */
export async function findProjectFreeTextValues(statuses: readonly string[], priorities: readonly string[], stageStatuses: readonly string[], db: DbExecutor = orm): Promise<ProjectFreeTextValue[]> {
  const list = (values: readonly string[]) => sql.join(values.map(v => sql`${v}`), sql`, `);
  return rowsOf(await db.execute(sql`
    SELECT 'project_status' AS kind, p.id, p.id AS project_id, p.project_code, COALESCE(p.status, '') AS value
      FROM production_projects p WHERE p.is_deleted = 0 AND COALESCE(p.status, '') NOT IN (${list(statuses)})
    UNION ALL
    SELECT 'project_priority', p.id, p.id, p.project_code, COALESCE(p.priority, '')
      FROM production_projects p WHERE p.is_deleted = 0 AND COALESCE(p.priority, '') NOT IN (${list(priorities)})
    UNION ALL
    SELECT 'stage_status', s.id, s.project_id, COALESCE(p.project_code, ''), COALESCE(s.status, '')
      FROM project_stages s JOIN production_projects p ON p.id = s.project_id
      WHERE s.is_deleted = 0 AND p.is_deleted = 0 AND COALESCE(s.status, '') NOT IN (${list(stageStatuses)})
    ORDER BY 3, 1, 2
  `)).map(r => ({
    kind: r.kind as ProjectFreeTextValue['kind'],
    id: Number(r.id),
    projectId: Number(r.project_id),
    projectCode: String(r.project_code ?? ''),
    value: String(r.value ?? ''),
  }));
}

const FREE_TEXT_KIND_LABELS: Record<ProjectFreeTextValue['kind'], string> = {
  project_status: 'وضعیت پروژه',
  project_priority: 'اولویت پروژه',
  stage_status: 'وضعیت مرحله',
};

export function buildProjectValueHealthTest(values: ProjectFreeTextValue[]): HealthCheckTestResult {
  const count = values.length;
  return {
    id: 'project_status_values',
    category: 'system',
    title: 'وضعیت و اولویت پروژه بیرون از فهرست',
    description: 'وضعیت و اولویت پروژه و وضعیت مرحله فقط از فهرست رابط پذیرفته می‌شوند. پیش از نسخه ۹.۰.۳۸۰ متن آزاد هم ذخیره می‌شد و چنین پروژه‌ای از پالایه‌های وضعیت بیرون می‌افتاد؛ این ردیف‌ها خودکار تغییر نمی‌کنند',
    status: count > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(5, count),
    count,
    message: count > 0
      ? `${toPersianDigits(count)} پروژه یا مرحله وضعیت یا اولویتی بیرون از فهرست دارد؛ آن را در صفحه پروژه از فهرست انتخاب و ذخیره کنید.`
      : 'وضعیت و اولویت همه پروژه‌ها و وضعیت همه مراحل از فهرست رابط است.',
    items: values.map(v => ({
      id: v.id,
      code: v.projectCode || `پروژه #${toPersianDigits(v.projectId)}`,
      title: `${FREE_TEXT_KIND_LABELS[v.kind]}: «${v.value}»`,
      subtitle: v.kind === 'stage_status' ? `مرحله #${toPersianDigits(v.id)}` : '',
      details: 'مقدار بیرون از فهرست رابط (TD-754).',
    })),
    metrics: { freeTextValues: count },
  };
}
