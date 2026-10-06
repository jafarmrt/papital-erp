import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { warehouses } from '../../db/schema.js';
import { fin } from '../../lib/financialDecimal.js';
import { InsufficientStockError, ValidationError } from '../../errors/customErrors.js';
import { isoToJalaliDate } from '../../utils/calendarDate.js';
import { normalizeDateToDbTimestamp } from '../../utils.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { createLedgerLocationResolver } from './warehouseResolver.js';

/**
 * v8.0.4 (TD-257، تصمیم مالک محصول ۱۲ مهر ۱۴۰۵): تاریخ گردش انبار نباید پیش از آخرین گردش همان کالا باشد.
 *
 * - مقایسه روزانه است: گردش هم‌روز با آخرین گردش آزاد است.
 * - گردش‌های سند ابطال‌شده (ردیف حذف‌شده و ردیف معکوس آن) «آخرین گردش» نیستند، تا اصلاح سند نهایی با ابطال و ثبت
 *   دوباره با همان تاریخ ممکن بماند.
 * - استثنا فقط با مجوز جدا (`warehouse.backdate`) است، و خروج با تاریخ گذشته فقط وقتی پذیرفته می‌شود که موجودی همان
 *   انبار به ترتیب تاریخ (روز، سپس ترتیب ثبت) در آن تاریخ و پس از آن منفی نشود.
 *
 * با این قاعده ترتیب تاریخ و ترتیب ثبت کاردکس یکی می‌ماند و بازسازی کاردکس با موتور زنده همخوان است (TD-258).
 */
export const BACKDATE_PERMISSION = 'warehouse.backdate';

/** v9.0.79 (TD-483، تصمیم ت۱ بسته ۶): گردش با تاریخ پس از امروز کسب‌وکار، برای همه کاربران و همه مسیرها */
export const FUTURE_MOVEMENT_CODE = 'STOCK_MOVEMENT_FUTURE_DATE';

/** ردیف‌های فعال کاردکس که گردش واقعی‌اند: بدون ردیف حذف‌شده و بدون ردیف معکوسِ ردیف حذف‌شده (همان دفتر §12) */
export const LEDGER_ROW_FILTER = sql`t.is_deleted = 0
  AND NOT EXISTS (SELECT 1 FROM transactions o WHERE o.id = t.reversal_of_id AND o.is_deleted = 1)`;

const QTY_TOLERANCE = 1e-9;

export interface StockMovementDateCheck {
  itemId: number;
  itemLabel: string;
  /** تاریخ گردش (میلادی ISO، با یا بدون ساعت، یا جلالی؛ با normalizeDateToDbTimestamp یکسان می‌شود) */
  date: string;
  inOut: 'in' | 'out';
  quantity: number;
  /** انباری که خروج از آن انجام می‌شود (برای کنترل موجودی تا تاریخ) */
  warehouseId: number;
  warehouseCode: string;
  allowBackdate?: boolean;
}

interface LedgerDayRow extends Record<string, unknown> {
  id: number;
  type: string;
  quantity: string;
  day: string;
  location: string | null;
}

/** آخرین روز گردش کالا (YYYY-MM-DD) یا null برای کالای بدون گردش */
export async function lastStockMovementDay(tx: DbExecutor, itemId: number): Promise<string | null> {
  const res = await tx.execute(sql`
    SELECT to_char(MAX(t.date), 'YYYY-MM-DD') AS last_day
      FROM transactions t
     WHERE t.item_id = ${itemId} AND ${LEDGER_ROW_FILTER}`);
  const value = (res.rows?.[0] as { last_day?: string | null } | undefined)?.last_day;
  return value ?? null;
}

/**
 * کمترین موجودی یک انبار از روز گردش به بعد، به ترتیب (روز، شناسه)، اگر گردش تازه در پایان همان روز ثبت شود.
 * خروج با تاریخ گذشته فقط وقتی مجاز است که این مقدار از مقدار خروج کمتر نباشد.
 */
async function minimumStockFromDay(tx: DbExecutor, itemId: number, day: string, warehouseId: number): Promise<number> {
  const res = await tx.execute(sql`
    SELECT t.id, t.type, t.quantity::text AS quantity, to_char(t.date, 'YYYY-MM-DD') AS day, t.location
      FROM transactions t
     WHERE t.item_id = ${itemId} AND ${LEDGER_ROW_FILTER}
     ORDER BY t.date::date, t.id`);
  const rows = (res.rows ?? []) as LedgerDayRow[];
  const allWarehouses = await tx.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name, isActive: warehouses.isActive })
    .from(warehouses);
  const resolve = createLedgerLocationResolver(allWarehouses);

  let balance = fin(0);
  let minimum: number | null = null;
  for (const row of rows) {
    const wh = resolve(row.location);
    if (!wh || wh.id !== warehouseId) continue;
    const isIn = row.type === 'in' || row.type === 'transfer_in';
    const isOut = row.type === 'out' || row.type === 'transfer_out';
    if (!isIn && !isOut) continue;
    if (row.day > day && minimum === null) minimum = balance.toNumber();
    balance = isIn ? balance.add(fin(row.quantity)) : balance.subtract(fin(row.quantity));
    if (row.day > day) minimum = Math.min(minimum ?? balance.toNumber(), balance.toNumber());
  }
  return minimum === null ? balance.toNumber() : minimum;
}

/** قاعده تاریخ گردش انبار (نه آینده، نه پیش از آخرین گردش کالا)؛ پیش از ثبت ردیف کاردکس و زیر قفل سطری کالا صدا زده می‌شود */
export async function assertStockMovementDate(tx: DbExecutor, check: StockMovementDateCheck): Promise<void> {
  const day = normalizeDateToDbTimestamp(check.date).slice(0, 10);
  const today = await businessTodayIsoDate();
  if (day > today) {
    throw new ValidationError(
      `تاریخ گردش کالای ${check.itemLabel} (${isoToJalaliDate(day)}) پس از امروز (${isoToJalaliDate(today)}) است. ` +
      'گردش انبار با تاریخ آینده ثبت نمی‌شود؛ تاریخ سند را اصلاح کنید.',
      { code: FUTURE_MOVEMENT_CODE, itemId: check.itemId, date: day, today }
    );
  }
  const lastDay = await lastStockMovementDay(tx, check.itemId);
  if (!lastDay || day >= lastDay) return;

  if (!check.allowBackdate) {
    throw new ValidationError(
      `تاریخ گردش کالای ${check.itemLabel} (${isoToJalaliDate(day)}) پیش از آخرین گردش همین کالا (${isoToJalaliDate(lastDay)}) است. ` +
      'سند انبار با تاریخ گذشته فقط با مجوز «ثبت سند انبار با تاریخ گذشته» ثبت می‌شود؛ تاریخ سند را اصلاح کنید.',
      { code: 'STOCK_MOVEMENT_BACKDATED', itemId: check.itemId, date: day, lastMovementDay: lastDay }
    );
  }
  if (check.inOut !== 'out') return;

  const available = await minimumStockFromDay(tx, check.itemId, day, check.warehouseId);
  if (available + QTY_TOLERANCE < check.quantity) {
    throw new InsufficientStockError(
      `خروج ${check.quantity} از کالای ${check.itemLabel} با تاریخ ${isoToJalaliDate(day)} ثبت نمی‌شود: موجودی انبار «${check.warehouseCode}» ` +
      `از آن تاریخ به بعد در جایی به ${Math.max(available, 0)} می‌رسد و با این خروج منفی می‌شود.`,
      { code: 'STOCK_NEGATIVE_AS_OF_DATE', itemId: check.itemId, date: day, available }
    );
  }
}
