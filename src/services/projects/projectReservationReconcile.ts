import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { productionProjects } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { ADVISORY_LOCK_KEYS } from '../../lib/advisoryLock.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { fin } from '../../lib/financialDecimal.js';
import { nextVersion } from '../../lib/occHelper.js';
import { hasPresetShapedSections, presetMaterialRefs, projectSectionsFromPreset } from '../../lib/projects/inventoryControlSections.js';
import { findProjectItemMatch } from '../../lib/projects/projectItemMatch.js';
import { projectNeedRefs, type ReservationShortage, type ReservationStockItem } from '../../lib/projects/projectReservation.js';
import { isProjectFinalized, reservationQtyField, storedReservationRows, storedReservationShortages } from '../../lib/projects/projectReservationState.js';
import { isProjectOpenForAllocation } from '../../lib/projects/projectStatus.js';
import {
  RESERVATION_PLAN_CHANGED_MESSAGE, reservationLineChange,
  type ReservationReconcileLine, type ReservationReconcilePreview, type ReservationReconcileResult,
} from '../../lib/projects/reservationReconcile.js';
import { logReservationReconcile } from './projectAudit.js';
import { lockLiveProject, type ProjectActor } from './projectStatusSync.js';
import { assertProjectVersion, projectVersionConflict } from './projectVersion.js';
import { planReservationWithOthers, readStockItemsForRefs } from './serverInventoryControl.js';

/**
 * TD-1341 (بستهٔ ۱۲ بند ۱، گزینهٔ ب کارت ت۴۲): «تکمیل رزرو» رزرو پروژهٔ ثبت نهایی‌شده را با فهرست مواد ذخیره‌شدهٔ امروز برابر
 * می‌کند، بی لغو ثبت نهایی. نیاز هر کالا قاعدهٔ ثبت نهایی است (`planReservationWithOthers`: بخش‌ها و اقلام دستی به واحد کالا،
 * منهای آنچه به پروژه داده شده)؛ رزرو فعلی پروژه تا نیاز می‌ماند، کمبود فقط از موجودی‌ای که هیچ‌کس رزرو نکرده پر می‌شود و
 * بیش از نیاز آزاد می‌شود. پیش‌نمایش فقط می‌خواند؛ ثبت زیر قفل ردیف پروژه، نسخهٔ زبانه و قفل ثبت نهایی (91011) همان را دوباره
 * حساب می‌کند و فقط وقتی می‌نویسد که نشانهٔ تغییرها همانی باشد که کاربر دید (وگرنه ۴۰۹ `PROJECT_RESERVATION_PLAN_CHANGED` با
 * پیش‌نمایش تازه). ردیف کالایی که عوض نمی‌شود دست نمی‌خورد، ردیف‌های کالای عوض‌شده یک ردیف با مقدار تازه می‌شوند و ردیفی که به
 * کالای زنده‌ای نمی‌رسد همان می‌ماند؛ پس هیچ رزروی بی‌صدا حذف یا دوبار شمرده نمی‌شود.
 */

type ProjectRow = typeof productionProjects.$inferSelect;
type InventoryControl = Record<string, unknown>;
type StoredRow = Record<string, unknown>;

const asObject = (v: unknown): InventoryControl => (v && typeof v === 'object' && !Array.isArray(v) ? (v as InventoryControl) : {});
/** متن یک مقدار JSONB، همان قاعدهٔ گزارش رزروها */
const rowText = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
/** شناسهٔ کالای ردیف ذخیره‌شده: عدد صحیح مثبت یا متن رقمی، وگرنه هیچ (همان گزارش رزروها) */
const refItemId = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
/** ردیف رزرو ذخیره‌شده به شکل ردیف مواد، همان فیلدهایی که گزارش رزروها می‌خواند */
const storedRowRef = (raw: StoredRow) => ({
  itemId: refItemId(raw.itemId),
  code: rowText(raw.itemCode) || rowText(raw.code),
  name: rowText(raw.itemName) || rowText(raw.name),
});
const qtyKey = (v: number): number => Math.round((Number(v) || 0) * 10_000);
const qty4 = (v: number): number => fin(v).round(4).toNumber();

interface ReconcileComputation {
  preview: ReservationReconcilePreview;
  reservedItems: StoredRow[];
  reservationShortages: ReservationShortage[];
}

function assertReconcilable(project: ProjectRow): void {
  if (!isProjectFinalized(project.inventoryControl)) {
    throw new ValidationError('فقط رزرو پروژهٔ ثبت نهایی‌شده تکمیل می‌شود؛ ابتدا «ثبت نهایی و رزرو انبار» را بزنید.', { projectId: project.id }, 'PROJECT_RESERVATION_NOT_FINALIZED');
  }
  if (!isProjectOpenForAllocation(project.status)) {
    throw new ValidationError('پروژهٔ تکمیل‌شده یا لغوشده رزرو نمی‌گیرد.', { projectId: project.id, status: project.status }, 'PROJECT_CLOSED_FOR_RESERVATION');
  }
}

/** رزرو فعلی پروژه به ازای کالای زنده: همان ردیف‌ها و همان فیلد مقداری که گزارش رزروها و کسر حواله می‌خوانند */
function ownReservationsByItem(rows: StoredRow[], stockItems: ReservationStockItem[]): { byItem: Map<number, number>; itemOfRow: (number | null)[] } {
  const byItem = new Map<number, number>();
  const itemOfRow = rows.map(raw => {
    const field = reservationQtyField(raw);
    const qty = field ? Number(raw[field]) : 0;
    if (!(qty > 0) || !Number.isFinite(qty)) return null;
    const match = findProjectItemMatch(storedRowRef(raw), stockItems);
    if (!match) return null;
    byItem.set(match.id, fin(byItem.get(match.id) ?? 0).add(qty).toNumber());
    return match.id;
  });
  return { byItem, itemOfRow };
}

/** نشانهٔ کمبودها بی موجودی لحظه‌ای (موجودی و رزرو دیگران در هر خواندن عوض می‌شوند و تغییر رزرو نیستند) */
const shortageSignature = (rows: ReadonlyArray<Partial<ReservationShortage>>): string =>
  JSON.stringify(rows
    .map(r => [Number(r.itemId) || 0, qtyKey(Number(r.requiredQty)), qtyKey(Number(r.reservedQty)), qtyKey(Number(r.shortQty))])
    .filter(r => r[3] > 0)
    .sort((a, b) => a[0] - b[0]));

async function computeReconcile(executor: DbExecutor, project: ProjectRow): Promise<ReconcileComputation> {
  assertReconcilable(project);
  const ic = asObject(project.inventoryControl);
  const products: unknown = project.products;
  // the finalize's narrowed item read (TD-1322, `readStockItemsForRefs`): the items the preset materials, the needs and the
  // stored reservation rows (by id too) may match, so every match is the one the whole item list gives
  let planIc: InventoryControl = ic;
  if (hasPresetShapedSections(ic.sections)) {
    const presetStock = await readStockItemsForRefs(executor, presetMaterialRefs(ic.sections));
    planIc = { ...ic, sections: projectSectionsFromPreset(ic.sections, Array.isArray(products) ? products : [], m => findProjectItemMatch({ code: m.code, name: m.name }, presetStock)?.currentStock) };
  }
  const storedRows = storedReservationRows<StoredRow>(ic);
  const storedRefs = storedRows.map(storedRowRef);
  const stockItems = await readStockItemsForRefs(
    executor,
    [...projectNeedRefs(planIc.sections, products, planIc.manualPurchaseItems), ...storedRefs],
    storedRefs.map(r => r.itemId).filter((id): id is number => id !== null),
  );
  const own = ownReservationsByItem(storedRows, stockItems);
  const reservedAt = systemNowUtcIso();
  const plan = await planReservationWithOthers(planIc, products, stockItems, reservedAt, executor, project.id, own.byItem);

  const planRow = new Map(plan.reserved.map(r => [Number(r.itemId), r]));
  const planShort = new Map(plan.shortages.map(s => [s.itemId, s]));
  const stockById = new Map(stockItems.map(i => [i.id, i]));
  const itemIds = [...new Set([...own.byItem.keys(), ...planRow.keys(), ...planShort.keys()])].sort((a, b) => a - b);
  const lines: ReservationReconcileLine[] = itemIds.map(itemId => {
    const item = stockById.get(itemId);
    const reserved = planRow.get(itemId);
    const short = planShort.get(itemId);
    return {
      itemId,
      itemCode: rowText(item?.code),
      itemName: rowText(item?.name),
      unit: rowText(item?.unit) || 'عدد',
      requiredQty: qty4(reserved?.originalQty ?? short?.requiredQty ?? 0),
      currentQty: qty4(own.byItem.get(itemId) ?? 0),
      targetQty: qty4(reserved?.reservedQty ?? 0),
      shortQty: qty4(short?.shortQty ?? 0),
    };
  });

  const changedItems = new Set(lines.filter(l => reservationLineChange(l) !== 'unchanged').map(l => l.itemId));
  const shortagesChanged = shortageSignature(storedReservationShortages(ic)) !== shortageSignature(plan.shortages);
  const hasChanges = changedItems.size > 0 || shortagesChanged;

  // ردیف کالای بی‌تغییر و ردیف بی کالای زنده همان می‌مانند؛ ردیف‌های کالای عوض‌شده جای نخستینشان یک ردیف تازه می‌شوند
  const reservedItems: StoredRow[] = [];
  const placed = new Set<number>();
  storedRows.forEach((raw, index) => {
    const itemId = own.itemOfRow[index];
    if (itemId === null || !changedItems.has(itemId)) {
      reservedItems.push(raw);
      return;
    }
    if (placed.has(itemId)) return;
    placed.add(itemId);
    const next = planRow.get(itemId);
    if (next) reservedItems.push({ ...next });
  });
  for (const r of plan.reserved) {
    const itemId = Number(r.itemId);
    if (changedItems.has(itemId) && !placed.has(itemId)) reservedItems.push({ ...r });
  }

  const planToken = createHash('sha256')
    .update(JSON.stringify({
      lines: lines.map(l => [l.itemId, qtyKey(l.requiredQty), qtyKey(l.currentQty), qtyKey(l.targetQty), qtyKey(l.shortQty)]),
      shortages: shortageSignature(plan.shortages),
      hasChanges,
    }))
    .digest('hex');

  return {
    preview: { projectId: project.id, version: project.version ?? 1, lines, hasChanges, planToken },
    reservedItems,
    reservationShortages: plan.shortages,
  };
}

async function readLiveProject(executor: DbExecutor, projectId: number): Promise<ProjectRow> {
  const [project] = await executor.select().from(productionProjects)
    .where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)));
  if (!project) throw new NotFoundError('پروژه مورد نظر یافت نشد', undefined, 'PROJECT_NOT_FOUND');
  return project;
}

/** پیش‌نمایش «تکمیل رزرو»: فقط خواندن */
export async function previewReservationReconcile(projectId: number): Promise<ReservationReconcilePreview> {
  const project = await readLiveProject(orm, projectId);
  return (await computeReconcile(orm, project)).preview;
}

/** ثبت «تکمیل رزرو» همان تغییرهایی که کاربر در پیش‌نمایش دید */
export async function applyReservationReconcile(
  projectId: number,
  input: { version: number; planToken: string },
  actor: ProjectActor,
): Promise<ReservationReconcileResult> {
  return orm.transaction(async tx => {
    const project = await lockLiveProject(tx, projectId);
    assertProjectVersion(project, input.version);
    // همان قفل ثبت نهایی (TD-819): ثبت نهایی‌ها و تکمیل رزروهای هم‌زمان رزرو دیگران را پشت سر هم می‌خوانند
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEYS.PROJECT_RESERVATION_FINALIZE}::bigint)`);
    const computed = await computeReconcile(tx, project);
    if (computed.preview.planToken !== input.planToken) {
      throw new ConflictError(RESERVATION_PLAN_CHANGED_MESSAGE, { preview: computed.preview }, 'PROJECT_RESERVATION_PLAN_CHANGED');
    }
    const ic = asObject(project.inventoryControl);
    const currentVersion = project.version ?? 1;
    if (!computed.preview.hasChanges) {
      return {
        id: project.id,
        version: currentVersion,
        changed: false,
        preview: computed.preview,
        inventory_control: { reservedItems: storedReservationRows(ic), reservationShortages: storedReservationShortages(ic) },
      };
    }
    const nextIc: InventoryControl = {
      ...ic,
      reservedItems: computed.reservedItems,
      isReserved: computed.reservedItems.length > 0,
      reservationShortages: computed.reservationShortages,
      lastUpdated: systemNowUtcIso(),
    };
    const version = nextVersion(currentVersion);
    const [updated] = await tx.update(productionProjects)
      .set({ inventoryControl: nextIc, version })
      .where(and(eq(productionProjects.id, project.id), eq(productionProjects.version, currentVersion)))
      .returning({ id: productionProjects.id });
    if (!updated) throw projectVersionConflict(project.id, input.version, currentVersion);
    await logReservationReconcile(tx, actor, project, {
      before: { reservedItems: storedReservationRows(ic), reservationShortages: storedReservationShortages(ic), version: currentVersion },
      after: { reservedItems: computed.reservedItems, reservationShortages: computed.reservationShortages, version },
      lines: computed.preview.lines,
    });
    return {
      id: project.id,
      version,
      changed: true,
      preview: computed.preview,
      inventory_control: { reservedItems: computed.reservedItems, reservationShortages: computed.reservationShortages },
    };
  });
}
