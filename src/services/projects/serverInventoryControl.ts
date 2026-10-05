import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items } from '../../db/schema.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { buildProjectReservation } from '../../lib/projects/projectReservation.js';

type InventoryControl = Record<string, unknown>;

const asObject = (v: unknown): InventoryControl => (v && typeof v === 'object' && !Array.isArray(v) ? (v as InventoryControl) : {});

/**
 * v8.0.58 (TD-306، تصمیم مالک محصول — گزینه الف): رزرو پروژه (`inventory_control.reservedItems`) را فقط سرور می‌نویسد.
 * `reservedItems` و `isReserved` بدنه درخواست نادیده گرفته می‌شوند:
 * - ثبت نهایی (isFinalized از false به true): رزرو از بخش‌های کنترل موجودی و موجودی کالا ساخته و زمان ثبت نهایی از سرور گذاشته می‌شود.
 * - ذخیره پروژه نهایی‌شده: رزرو فعلی (پس از کسرهای حواله خروج) همان می‌ماند.
 * - خروج از ثبت نهایی: رزرو خالی می‌شود.
 * - پروژه نهایی‌نشده: رزرو قبلی دست نمی‌خورد.
 */
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
    reservedItems = buildProjectReservation(
      rest.sections,
      products,
      stockItems.map(i => ({ ...i, currentStock: Number(i.currentStock) || 0 })),
      rest.manualPurchaseItems,
      String(finalizedAt)
    );
  } else if (!nowFinal && wasFinal) {
    reservedItems = [];
    finalizedAt = undefined;
  }

  const result: InventoryControl = { ...rest, isFinalized: nowFinal, reservedItems, isReserved: reservedItems.length > 0 };
  if (nowFinal && finalizedAt) result.finalizedAt = finalizedAt;
  return result;
}
