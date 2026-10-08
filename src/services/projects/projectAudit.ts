import type { DbExecutor } from '../../db/drizzle.js';
import type { productionProjects, projectStages } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { projectPriorityLabel, projectStatusLabel, stageStatusLabel } from '../../lib/projects/projectStatus.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import type { ProjectActor } from './projectStatusSync.js';

/**
 * v9.0.341 (TD-757، AGENTS §5): ممیزی ویرایش پروژه و افزودن، ویرایش و حذف مرحله با پیش و پس، درون تراکنش همان نوشتن.
 * پیش‌تر ویرایش پروژه با `details: {}` و بیرون از تراکنش ثبت می‌شد و مسیرهای مرحله هیچ ردیف ممیزی نداشتند.
 */
export const PROJECT_AUDIT_ENTITY = 'پروژه تولید';
export const PROJECT_STAGE_AUDIT_ENTITY = 'مرحله پروژه تولید';

type ProjectRow = typeof productionProjects.$inferSelect;
type StageRow = typeof projectStages.$inferSelect;
type Snapshot = Record<string, unknown>;

const text = (v: unknown): unknown => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : v);
const count = (v: unknown): number => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0);

/** محصولات پروژه به شکل «کد × مقدار» (فهرست کوتاه و خوانا در ممیزی) */
function productsSummary(products: unknown): string[] {
  if (!Array.isArray(products)) return [];
  return products.map(p => {
    const r = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    const name = String(r.item_code || r.itemCode || r.item_name || r.itemName || '');
    return `${name} × ${String(r.quantity ?? '')}`;
  });
}

/** نمای ممیزی پروژه؛ ستون‌های JSON بزرگ با شمار ردیف و نشانه تغییر (`raw`) */
export function projectAuditSnapshot(row: ProjectRow): { view: Snapshot; raw: Snapshot } {
  const view: Snapshot = {
    projectCode: text(row.projectCode),
    title: text(row.title),
    customerId: text(row.customerId),
    customerName: text(row.customerName),
    itemId: text(row.itemId),
    itemCode: text(row.itemCode),
    itemName: text(row.itemName),
    quantity: text(row.quantity),
    unit: text(row.unit),
    startDate: text(row.startDate),
    endDate: text(row.endDate),
    status: projectStatusLabel(row.status),
    priority: projectPriorityLabel(row.priority),
    description: text(row.description),
    products: productsSummary(row.products),
    inventoryControl: `${toPersianDigits(count((row.inventoryControl as { sections?: unknown } | null)?.sections))} بخش`,
    stageSchedules: `${toPersianDigits(count(row.stageSchedules))} برنامه مرحله`,
    customStages: `${toPersianDigits(count(row.customStages))} مرحله سفارشی`,
    attachments: `${toPersianDigits(count(row.attachments))} پیوست`,
  };
  const raw: Snapshot = { ...view, products: text(row.products), inventoryControl: text(row.inventoryControl), stageSchedules: text(row.stageSchedules), customStages: text(row.customStages), attachments: text(row.attachments) };
  return { view, raw };
}

/** فقط فیلدهای تغییرکرده با پیش و پس */
function changedFields(before: { view: Snapshot; raw: Snapshot }, after: { view: Snapshot; raw: Snapshot }) {
  const b: Snapshot = {};
  const a: Snapshot = {};
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of Object.keys(after.raw)) {
    if (String(before.raw[key]) === String(after.raw[key])) continue;
    b[key] = before.view[key];
    a[key] = after.view[key];
    changes[key] = { before: before.view[key], after: after.view[key] };
  }
  return { before: b, after: a, changes };
}

const actorFields = (actor: ProjectActor) => ({ req: actor.req, userId: actor.userId, username: actor.username, userFullName: actor.userFullName });

/** ویرایش پروژه: پیش و پس فیلدهای تغییرکرده، با `tx` همان ویرایش */
export async function logProjectUpdate(tx: DbExecutor, actor: ProjectActor, before: ProjectRow, after: ProjectRow): Promise<void> {
  const details = changedFields(projectAuditSnapshot(before), projectAuditSnapshot(after));
  await logActivity({
    tx,
    ...actorFields(actor),
    action: 'UPDATE',
    entity: PROJECT_AUDIT_ENTITY,
    entityId: String(after.id),
    description: `ویرایش مشخصات پروژه تولید ${after.projectCode} (${after.title})`,
    details,
  });
}

export function stageAuditSnapshot(row: StageRow): Snapshot {
  return {
    title: text(row.title),
    stageOrder: text(row.stageOrder),
    status: stageStatusLabel(row.status),
    progressPercent: text(row.progressPercent),
    startDate: text(row.startDate),
    endDate: text(row.endDate),
    completedAt: text(row.completedAt),
    assignedPersonnel: text(row.assignedPersonnel),
    requiredResources: text(row.requiredResources),
    notes: text(row.notes),
  };
}

const STAGE_ACTION_TEXT = { CREATE: 'افزوده شد', UPDATE: 'ویرایش شد', DELETE: 'حذف شد' } as const;

/** افزودن، ویرایش یا حذف مرحله: ردیف ممیزی با پروژه و پیش و پس مرحله، با `tx` همان نوشتن */
export async function logStageChange(
  tx: DbExecutor,
  actor: ProjectActor,
  action: keyof typeof STAGE_ACTION_TEXT,
  project: Pick<ProjectRow, 'id' | 'projectCode'>,
  before: StageRow | null,
  after: StageRow | null,
): Promise<void> {
  const stage = (after ?? before) as StageRow;
  const b = before ? stageAuditSnapshot(before) : null;
  const a = after ? stageAuditSnapshot(after) : null;
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  if (b && a) {
    for (const key of Object.keys(a)) if (String(b[key]) !== String(a[key])) changes[key] = { before: b[key], after: a[key] };
  }
  await logActivity({
    tx,
    ...actorFields(actor),
    action,
    entity: PROJECT_STAGE_AUDIT_ENTITY,
    entityId: String(stage.id),
    description: `مرحله «${stage.title}» (شماره ${toPersianDigits(stage.stageOrder)}) پروژه تولید ${project.projectCode} ${STAGE_ACTION_TEXT[action]}`,
    details: {
      projectId: project.id,
      projectCode: project.projectCode,
      ...(b ? { before: b } : {}),
      ...(a ? { after: a } : {}),
      ...(b && a ? { changes } : {}),
    },
  });
}

/**
 * v9.0.334 (TD-738): تغییر وضعیت پروژه با ماتریس پیشرفت (همگام‌ساز `syncProjectFromMatrix`)، با پیش و پس و شمار خانه‌ها،
 * با `tx` همان نوشتن
 */
export async function logMatrixStatusChange(
  tx: DbExecutor,
  actor: ProjectActor,
  project: Pick<ProjectRow, 'id' | 'projectCode' | 'status'>,
  nextStatus: string,
  matrix: { completedCells: number; totalCells: number },
): Promise<void> {
  const before = projectStatusLabel(project.status);
  const after = projectStatusLabel(nextStatus);
  await logActivity({
    tx,
    ...actorFields(actor),
    action: 'UPDATE',
    entity: PROJECT_AUDIT_ENTITY,
    entityId: String(project.id),
    description: `وضعیت پروژه تولید ${project.projectCode} با ماتریس پیشرفت از «${before}» به «${after}» تغییر کرد`,
    details: {
      before: { status: before },
      after: { status: after },
      changes: { status: { before, after } },
      completedMatrixCells: matrix.completedCells,
      totalMatrixCells: matrix.totalCells,
    },
  });
}
