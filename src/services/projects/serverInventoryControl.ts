import { eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items } from '../../db/schema.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import {
  planProjectReservation, type ProjectReservationPlan, type ReservationStockItem, type ReservationUnitMismatch,
} from '../../lib/projects/projectReservation.js';
import { ADVISORY_LOCK_KEYS } from '../../lib/advisoryLock.js';
import { ItemStockReservationService } from '../items/itemStockReservation.service.js';
import { ValidationError } from '../../errors/customErrors.js';

type InventoryControl = Record<string, unknown>;

const asObject = (v: unknown): InventoryControl => (v && typeof v === 'object' && !Array.isArray(v) ? (v as InventoryControl) : {});

/**
 * v8.0.58 (TD-306، تصمیم مالک محصول — گزینه الف): رزرو پروژه (`inventory_control.reservedItems`) را فقط سرور می‌نویسد.
 * `reservedItems` و `isReserved` بدنه درخواست نادیده گرفته می‌شوند:
 * - ثبت نهایی (isFinalized از false به true): رزرو از بخش‌های کنترل موجودی و موجودی کالا ساخته و زمان ثبت نهایی از سرور گذاشته می‌شود.
 * - ذخیره پروژه نهایی‌شده: رزرو فعلی (پس از کسرهای حواله خروج) همان می‌ماند.
 * - خروج از ثبت نهایی: رزرو خالی می‌شود.
 * - پروژه نهایی‌نشده: رزرو قبلی دست نمی‌خورد.
 * v9.0.350 (TD-820): ردیفی که واحدش با واحد کالا فرق دارد و تبدیل واحد معتبر ندارد، ثبت نهایی را با ۴۲۲
 * `PROJECT_RESERVATION_UNIT_MISMATCH` رد می‌کند.
 * v9.0.351 (TD-819): ثبت نهایی فقط موجودی آزاد (کل − رزرو دیگران) را رزرو می‌کند و کمبود را در
 * `reservationShortages` می‌نویسد؛ کمبود بدنه درخواست نادیده گرفته و با خروج از ثبت نهایی پاک می‌شود.
 */
function unitMismatchError(rows: ReservationUnitMismatch[]): ValidationError {
  const list = rows.map(r => `«${r.itemName || r.itemCode}» (کنترل موجودی: ${r.rowUnit}، کالا: ${r.itemUnit})`).join('؛ ');
  return new ValidationError(
    `واحد این مواد با واحد کالای انبار فرق دارد و تبدیل واحد ندارد: ${list}. پیش از ثبت نهایی، تبدیل واحد هر ردیف را در کنترل موجودی ثبت کنید.`,
    { unitMismatches: rows },
    'PROJECT_RESERVATION_UNIT_MISMATCH',
  );
}

/**
 * رزرو پروژه با رزرو دیگران (TD-819): یک بار نیازها و کالاهای تطبیق‌یافته ساخته می‌شوند، رزرو دیگران فقط برای همان کالاها
 * خوانده می‌شود (خطای خواندن ثبت نهایی را رد می‌کند) و رزرو با موجودی آزاد دوباره حساب می‌شود.
 */
async function planWithOthersReservations(
  ic: InventoryControl,
  products: unknown,
  stockItems: ReservationStockItem[],
  reservedAt: string,
  executor: DbExecutor,
): Promise<ProjectReservationPlan> {
  const draft = planProjectReservation(ic.sections, products, stockItems, ic.manualPurchaseItems, reservedAt);
  // v9.0.350 (TD-820، تصمیم ت۴): ردیف با واحد دیگر و بی تبدیل، ثبت نهایی را رد می‌کند
  if (draft.unitMismatches.length > 0) throw unitMismatchError(draft.unitMismatches);
  const itemIds = draft.reserved.map(r => Number(r.itemId)).filter(id => Number.isInteger(id) && id > 0);
  if (itemIds.length === 0) return draft;
  const report = await ItemStockReservationService.getReservedStockDetails(executor, true, { itemIds });
  const reservedByOthers = new Map<number, number>();
  for (const s of report.itemSummaries) {
    if (s.itemId) reservedByOthers.set(Number(s.itemId), Number(s.totalReservedQty) || 0);
  }
  return planProjectReservation(ic.sections, products, stockItems, ic.manualPurchaseItems, reservedAt, { reservedByOthers });
}

export async function resolveServerInventoryControl(
  incoming: unknown,
  previous: unknown,
  products: unknown,
  executor: DbExecutor
): Promise<InventoryControl> {
  const {
    reservedItems: _ignoredReserved, isReserved: _ignoredFlag, finalizedAt: _ignoredFinalizedAt, reservationShortages: _ignoredShortages, ...rest
  } = asObject(incoming);
  const prev = asObject(previous);
  const prevReserved = Array.isArray(prev.reservedItems) ? prev.reservedItems : [];
  const wasFinal = prev.isFinalized === true;
  const nowFinal = rest.isFinalized === true;

  let reservedItems: unknown[] = prevReserved;
  let finalizedAt: unknown = prev.finalizedAt;
  let shortages: unknown = prev.reservationShortages;
  if (nowFinal && !wasFinal) {
    // v9.0.351 (TD-819): ثبت نهایی‌های هم‌زمان پشت سر هم رزرو دیگران را می‌خوانند
    await executor.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEYS.PROJECT_RESERVATION_FINALIZE}::bigint)`);
    const stockItems = await executor
      .select({ id: items.id, code: items.code, name: items.name, category: items.category, unit: items.unit, currentStock: items.currentStock })
      .from(items)
      .where(eq(items.isDeleted, 0));
    finalizedAt = systemNowUtcIso();
    const plan = await planWithOthersReservations(rest, products, stockItems.map(i => ({ ...i, currentStock: Number(i.currentStock) || 0 })), String(finalizedAt), executor);
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
