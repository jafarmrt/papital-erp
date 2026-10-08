import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items } from '../../db/schema.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { planProjectReservation, type ReservationUnitMismatch } from '../../lib/projects/projectReservation.js';
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
 */
function unitMismatchError(rows: ReservationUnitMismatch[]): ValidationError {
  const list = rows.map(r => `«${r.itemName || r.itemCode}» (کنترل موجودی: ${r.rowUnit}، کالا: ${r.itemUnit})`).join('؛ ');
  return new ValidationError(
    `واحد این مواد با واحد کالای انبار فرق دارد و تبدیل واحد ندارد: ${list}. پیش از ثبت نهایی، تبدیل واحد هر ردیف را در کنترل موجودی ثبت کنید.`,
    { unitMismatches: rows },
    'PROJECT_RESERVATION_UNIT_MISMATCH',
  );
}

export async function resolveServerInventoryControl(
  incoming: unknown,
  previous: unknown,
  products: unknown,
  executor: DbExecutor
): Promise<InventoryControl> {
  const { reservedItems: _ignoredReserved, isReserved: _ignoredFlag, finalizedAt: _ignoredFinalizedAt, ...rest } = asObject(incoming);
  const prev = asObject(previous);
  const prevReserved = Array.isArray(prev.reservedItems) ? prev.reservedItems : [];
  const wasFinal = prev.isFinalized === true;
  const nowFinal = rest.isFinalized === true;

  let reservedItems: unknown[] = prevReserved;
  let finalizedAt: unknown = prev.finalizedAt;
  if (nowFinal && !wasFinal) {
    const stockItems = await executor
      .select({ id: items.id, code: items.code, name: items.name, category: items.category, unit: items.unit, currentStock: items.currentStock })
      .from(items)
      .where(eq(items.isDeleted, 0));
    finalizedAt = systemNowUtcIso();
    const plan = planProjectReservation(
      rest.sections,
      products,
      stockItems.map(i => ({ ...i, currentStock: Number(i.currentStock) || 0 })),
      rest.manualPurchaseItems,
      String(finalizedAt)
    );
    // v9.0.350 (TD-820، تصمیم ت۴): ردیف با واحد دیگر و بی تبدیل، ثبت نهایی را رد می‌کند
    if (plan.unitMismatches.length > 0) throw unitMismatchError(plan.unitMismatches);
    reservedItems = plan.reserved;
  } else if (!nowFinal && wasFinal) {
    reservedItems = [];
    finalizedAt = undefined;
  }

  const result: InventoryControl = { ...rest, isFinalized: nowFinal, reservedItems, isReserved: reservedItems.length > 0 };
  if (nowFinal && finalizedAt) result.finalizedAt = finalizedAt;
  return result;
}
