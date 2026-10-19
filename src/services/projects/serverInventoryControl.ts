import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { projectIssuedQuantities } from './projectIssuedQuantities.js';
import type { DbExecutor } from '../../db/drizzle.js';
import { items, productionProjects } from '../../db/schema.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import {
  planProjectReservation, projectNeedRefs, type ProjectReservationPlan, type ReservationStockItem, type ReservationUnitMismatch,
} from '../../lib/projects/projectReservation.js';
import { ADVISORY_LOCK_KEYS } from '../../lib/advisoryLock.js';
import { ItemStockReservationService, othersReservations } from '../items/itemStockReservation.service.js';
import { NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import {
  MATERIAL_AVAILABILITY_MAX_ITEMS, freeForProject, type MaterialAvailabilityReport,
} from '../../lib/projects/materialAvailability.js';
import { hasPresetShapedSections, presetMaterialRefs, projectSectionsFromPreset } from '../../lib/projects/inventoryControlSections.js';
import { findProjectItemMatch, itemRefKeys, type MatchableItem } from '../../lib/projects/projectItemMatch.js';
import { itemRefKeyCondition } from '../items/itemRefKeyRead.js';

type InventoryControl = Record<string, unknown>;

const asObject = (v: unknown): InventoryControl => (v && typeof v === 'object' && !Array.isArray(v) ? (v as InventoryControl) : {});

/**
 * v8.0.58 (TD-306، تصمیم مالک محصول — گزینه الف): رزرو پروژه (`inventory_control.reservedItems`) را فقط سرور می‌نویسد.
 * `reservedItems` و `isReserved` بدنه درخواست نادیده گرفته می‌شوند:
 * - ثبت نهایی (isFinalized از false به true): رزرو از بخش‌های کنترل موجودی و موجودی کالا ساخته و زمان ثبت نهایی از سرور گذاشته می‌شود.
 * - ذخیره پروژه نهایی‌شده: رزرو فعلی (پس از کسرهای حواله خروج) همان می‌ماند.
 * - خروج از ثبت نهایی: رزرو خالی می‌شود.
 * - پروژه نهایی‌نشده: رزرو قبلی دست نمی‌خورد.
 * v9.0.372 (TD-820): ردیفی که واحدش با واحد کالا فرق دارد و تبدیل واحد معتبر ندارد، ثبت نهایی را با ۴۲۲
 * `PROJECT_RESERVATION_UNIT_MISMATCH` رد می‌کند.
 * v9.0.373 (TD-819): ثبت نهایی فقط موجودی آزاد (کل − رزرو دیگران) را رزرو می‌کند و کمبود را در
 * `reservationShortages` می‌نویسد؛ کمبود بدنه درخواست نادیده گرفته و با خروج از ثبت نهایی پاک می‌شود.
 */
function unitMismatchError(rows: ReservationUnitMismatch[], action: 'ثبت نهایی' | 'تکمیل رزرو'): ValidationError {
  const list = rows.map(r => `«${r.itemName || r.itemCode}» (کنترل موجودی: ${r.rowUnit}، کالا: ${r.itemUnit})`).join('؛ ');
  return new ValidationError(
    `واحد این مواد با واحد کالای انبار فرق دارد و تبدیل واحد ندارد: ${list}. پیش از ${action}، تبدیل واحد هر ردیف را در کنترل موجودی ثبت کنید.`,
    { unitMismatches: rows },
    'PROJECT_RESERVATION_UNIT_MISMATCH',
  );
}

/**
 * رزرو پروژه با رزرو دیگران (TD-819): یک بار نیازها و کالاهای تطبیق‌یافته ساخته می‌شوند، رزرو دیگران فقط برای همان کالاها
 * خوانده می‌شود (خطای خواندن ثبت نهایی را رد می‌کند) و رزرو با موجودی آزاد دوباره حساب می‌شود.
 * TD-1341: رزرو دیگران با `othersReservations` خوانده می‌شود، پس رزرو خود پروژه (ثبت نهایی‌شده، در «تکمیل رزرو») رزرو دیگران
 * شمرده نمی‌شود؛ `reconcile.ownReserved` رزرو فعلی پروژه است و کالاهای آن هم خوانده می‌شوند، و `reconcile.itemAliases` کد و نامی
 * است که هر ردیف رزرو ذخیره‌شده برای کالای خود نگه داشته (M1). در ثبت نهایی پروژه هنوز ثبت نهایی نیست و هیچ ردیفش رزرو
 * نمی‌کند، پس نتیجه همان پیشین است.
 */
export async function planReservationWithOthers(
  ic: InventoryControl,
  products: unknown,
  stockItems: ReservationStockItem[],
  reservedAt: string,
  executor: DbExecutor,
  projectId: number | null,
  reconcile?: { ownReserved: ReadonlyMap<number, number>; itemAliases: ReadonlyArray<MatchableItem> },
): Promise<ProjectReservationPlan> {
  const ownReserved = reconcile?.ownReserved;
  const itemAliases = reconcile?.itemAliases;
  const draft = planProjectReservation(ic.sections, products, stockItems, ic.manualPurchaseItems, reservedAt, itemAliases ? { itemAliases } : {});
  // v9.0.372 (TD-820، تصمیم ت۴): ردیف با واحد دیگر و بی تبدیل، ثبت نهایی را رد می‌کند
  if (draft.unitMismatches.length > 0) throw unitMismatchError(draft.unitMismatches, reconcile ? 'تکمیل رزرو' : 'ثبت نهایی');
  const itemIds = [...new Set([...draft.reserved, ...draft.shortages].map(r => Number(r.itemId)).concat([...(ownReserved?.keys() ?? [])]))]
    .filter(id => Number.isInteger(id) && id > 0);
  if (itemIds.length === 0) return draft;
  const issuedToProject = projectId ? await projectIssuedQuantities(executor, projectId, itemIds) : new Map<number, number>();
  const report = await ItemStockReservationService.getReservedStockDetails(executor, true, { itemIds });
  const reservedByOthers = new Map<number, number>();
  for (const s of report.itemSummaries) {
    const itemId = Number(s.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) continue;
    const rows = othersReservations(s.reservations, { projectId });
    reservedByOthers.set(itemId, rows.reduce((sum, r) => fin(sum).add(Number(r.reservedQty) || 0).toNumber(), 0));
  }
  return planProjectReservation(ic.sections, products, stockItems, ic.manualPurchaseItems, reservedAt, { reservedByOthers, issuedToProject, ownReserved, itemAliases });
}

const STOCK_ITEM_COLUMNS = {
  id: items.id, code: items.code, name: items.name, category: items.category, unit: items.unit, currentStock: items.currentStock,
};

/**
 * The live items that may be a ref's `findProjectItemMatch` among every live item, in id order (`itemRefKeyCondition`):
 * the list holds every item that matches a ref, so each ref gets the lowest-id match, by code then by name. TD-1341:
 * `itemIds` are the ids refs carry (the stored reservation rows of «تکمیل رزرو»); those items are read too, so a match by
 * id is the same as well.
 */
export async function readStockItemsForRefs(
  executor: DbExecutor,
  refs: ReadonlyArray<{ code: string; name: string }>,
  itemIds: readonly number[] = [],
): Promise<ReservationStockItem[]> {
  const narrow = itemRefKeyCondition({ ...itemRefKeys(refs), ids: itemIds });
  if (!narrow) return [];
  const rows = await executor
    .select(STOCK_ITEM_COLUMNS)
    .from(items)
    .where(and(eq(items.isDeleted, 0), narrow))
    .orderBy(asc(items.id));
  return rows.map(i => ({ ...i, currentStock: Number(i.currentStock) || 0 }));
}

export async function resolveServerInventoryControl(
  incoming: unknown,
  previous: unknown,
  products: unknown,
  executor: DbExecutor,
  projectId: number | null = null,
): Promise<InventoryControl> {
  const {
    reservedItems: _ignoredReserved, isReserved: _ignoredFlag, finalizedAt: _ignoredFinalizedAt, reservationShortages: _ignoredShortages, ...rest
  } = asObject(incoming);
  const prev = asObject(previous);
  const prevReserved = Array.isArray(prev.reservedItems) ? prev.reservedItems : [];
  const wasFinal = prev.isFinalized === true;
  const nowFinal = rest.isFinalized === true;

  const finalizing = nowFinal && !wasFinal;
  // v9.0.373 (TD-819): ثبت نهایی‌های هم‌زمان پشت سر هم رزرو دیگران را می‌خوانند
  if (finalizing) await executor.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEYS.PROJECT_RESERVATION_FINALIZE}::bigint)`);
  // v9.0.413 (TD-748): بخش الگو (مواد در `items`) با ردیف‌های پروژه ذخیره می‌شود تا رزرو و صفحه‌ها همان ردیف‌ها را بخوانند
  // OBS-R2-45 (TD-1322): only the live items that may match a row are read (`readStockItemsForRefs`): every item the rows
  // name by code key or name key and every item whose letter case SQL may map unlike JavaScript, so a row gets the lowest-id match
  if (hasPresetShapedSections(rest.sections)) {
    const presetStock = await readStockItemsForRefs(executor, presetMaterialRefs(rest.sections));
    rest.sections = projectSectionsFromPreset(rest.sections, Array.isArray(products) ? products : [], material =>
      findProjectItemMatch({ code: material.code, name: material.name }, presetStock)?.currentStock);
  }
  const stockItems: ReservationStockItem[] = finalizing
    ? await readStockItemsForRefs(executor, projectNeedRefs(rest.sections, products, rest.manualPurchaseItems))
    : [];

  let reservedItems: unknown[] = prevReserved;
  let finalizedAt: unknown = prev.finalizedAt;
  let shortages: unknown = prev.reservationShortages;
  if (finalizing) {
    finalizedAt = systemNowUtcIso();
    const plan = await planReservationWithOthers(rest, products, stockItems, String(finalizedAt), executor, projectId);
    reservedItems = plan.reserved;
    shortages = plan.shortages;
  } else if (!nowFinal && wasFinal) {
    reservedItems = [];
    finalizedAt = undefined;
    shortages = undefined;
  }

  const result: InventoryControl = { ...rest, isFinalized: nowFinal, reservedItems, isReserved: reservedItems.length > 0 };
  if (nowFinal && finalizedAt) result.finalizedAt = finalizedAt;
  if (nowFinal && Array.isArray(shortages)) result.reservationShortages = shortages;
  return result;
}

/**
 * v10.2.3 (TD-1290، یافتهٔ D1): ارقام موجودی آزاد کالاهای `itemIds` برای پروژه، با همان ورودی‌های ثبت نهایی: موجودی کل کالا،
 * رزرو پیش‌فاکتورهای فروش و پروژه‌های ثبت نهایی‌شدهٔ دیگر (رزرو خود این پروژه کنار می‌رود، `othersReservations`) و آنچه تاکنون
 * به پروژه داده شده (`projectIssuedQuantities`). فقط خواندن است؛ خطای خواندن رزروها به فراخواننده می‌رسد و هرگز رزرو صفر
 * نمی‌شود (TD-821). کالای حذف‌شده یا ناموجود در پاسخ نمی‌آید.
 */
export async function projectMaterialAvailability(executor: DbExecutor, projectId: number, itemIds: readonly number[]): Promise<MaterialAvailabilityReport> {
  const [project] = await executor.select({ id: productionProjects.id }).from(productionProjects)
    .where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)));
  if (!project) throw new NotFoundError('پروژه مورد نظر یافت نشد', undefined, 'PROJECT_NOT_FOUND');
  const ids = [...new Set(itemIds)].filter(id => Number.isInteger(id) && id > 0).sort((a, b) => a - b).slice(0, MATERIAL_AVAILABILITY_MAX_ITEMS);
  if (ids.length === 0) return { projectId, items: [] };
  const stockRows = await executor.select({ id: items.id, currentStock: items.currentStock }).from(items)
    .where(and(eq(items.isDeleted, 0), inArray(items.id, ids)));
  const issued = await projectIssuedQuantities(executor, projectId, ids);
  const report = await ItemStockReservationService.getReservedStockDetails(executor, true, { itemIds: ids });
  const others = new Map<number, number>();
  for (const s of report.itemSummaries) {
    const itemId = Number(s.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) continue;
    const rows = othersReservations(s.reservations, { projectId });
    others.set(itemId, rows.reduce((sum, r) => fin(sum).add(Number(r.reservedQty) || 0).toNumber(), 0));
  }
  return {
    projectId,
    items: stockRows.sort((a, b) => a.id - b.id).map(r => {
      const stock = fin(r.currentStock ?? 0).toNumber();
      const reservedByOthers = others.get(r.id) ?? 0;
      return { itemId: r.id, stock, reservedByOthers, issuedToProject: issued.get(r.id) ?? 0, freeForProject: freeForProject(stock, reservedByOthers) };
    }),
  };
}
