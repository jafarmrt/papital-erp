import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items, transactions, warehouses } from '../../db/schema.js';
import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { InsufficientStockError } from '../../errors/customErrors.js';
import { isoToJalaliDate } from '../../utils/calendarDate.js';
import { createLedgerLocationResolver } from './warehouseResolver.js';
import { LEDGER_ROW_FILTER } from './stockMovementDate.js';

/**
 * v8.0.6 (TD-265، تصمیم مالک محصول ۱۲ مهر ۱۴۰۵ — گزینه الف): ابطال سند ورودی (رسید، خرید، رسید تولید، برگشت از فروش،
 * اضافی انبارگردانی) وقتی موجودی‌اش با خروجِ تاریخ‌دار بعدی مصرف شده باشد رد می‌شود.
 *
 * پیش‌تر ابطال فقط موجودی لحظه ابطال را می‌سنجید؛ اگر ورودی‌های بعدی آن را پوشش می‌دادند ابطال پذیرفته می‌شد و کاردکس
 * به ترتیب تاریخ از تاریخ آن ورودی منفی می‌شد (کالا پیش از ورود خارج شده بود). همان اصل TD-257: موجودی هر انبار به ترتیب
 * (روز، شناسه) در هیچ تاریخی منفی نمی‌شود. ابطال فقط وقتی رد می‌شود که خودِ این سند مانده را منفی کند؛ ابطال سند خروجی
 * هرگز رد نمی‌شود، چون موجودی را برمی‌گرداند.
 */

const QTY_TOLERANCE = 1e-9;
const MAX_LISTED_DOCUMENTS = 3;

const DOCUMENT_TYPE_TITLES: Record<string, string> = {
  invoice: 'فاکتور فروش',
  remittance: 'حواله خروج',
  waste: 'ضایعات',
  audit: 'انبارگردانی',
  transfer: 'انتقال انبار',
  return: 'برگشت از فروش',
  receipt: 'رسید',
  purchase: 'خرید',
  production_receipt: 'رسید تولید',
};

interface LedgerRow extends Record<string, unknown> {
  id: number;
  type: string;
  quantity: string;
  day: string;
  location: string | null;
  document_type: string | null;
  document_ref: string | null;
}

interface WarehouseRef { id: number; code: string }

function signedQuantity(row: LedgerRow): FinancialDecimal {
  if (row.type === 'in' || row.type === 'transfer_in') return fin(row.quantity);
  if (row.type === 'out' || row.type === 'transfer_out') return fin(row.quantity).negate();
  return fin(0);
}

/** نخستین انباری که بدون ردیف‌های سند، به ترتیب (روز، شناسه) منفی می‌شود؛ یا null */
function firstBrokenWarehouse(rows: LedgerRow[], removedIds: Set<number>, resolve: (raw: unknown) => WarehouseRef | null) {
  const before = new Map<number, FinancialDecimal>();
  const after = new Map<number, FinancialDecimal>();
  const broken = new Map<number, { warehouse: WarehouseRef; day: string; deepest: FinancialDecimal; consumers: LedgerRow[] }>();
  for (const row of rows) {
    const wh = resolve(row.location);
    if (!wh) continue;
    const signed = signedQuantity(row);
    const b = (before.get(wh.id) ?? fin(0)).add(signed);
    before.set(wh.id, b);
    const a = removedIds.has(row.id) ? (after.get(wh.id) ?? fin(0)) : (after.get(wh.id) ?? fin(0)).add(signed);
    after.set(wh.id, a);
    // فقط منفی‌شدنی که این ابطال می‌سازد (کاردکس قدیمیِ از پیش منفی مانع ابطال‌های بی‌ربط نشود)
    if (a.lessThan(-QTY_TOLERANCE) && b.subtract(a).greaterThan(QTY_TOLERANCE)) {
      const found = broken.get(wh.id) ?? { warehouse: wh, day: row.day, deepest: a, consumers: [] };
      if (a.lessThan(found.deepest)) found.deepest = a;
      if (signed.isNegative() && !removedIds.has(row.id)) found.consumers.push(row);
      broken.set(wh.id, found);
    }
  }
  return broken.values().next().value ?? null;
}

/**
 * پیش از ابطال سند فراخوانده می‌شود (زیر قفل سند). کالاهای ورودی سند به ترتیب شناسه قفل می‌شوند تا خروج همزمان
 * میان بررسی و ابطال رخ ندهد.
 */
export async function assertVoidKeepsStockHistory(tx: DbExecutor, doc: { id: number; refNumber: string | null }): Promise<void> {
  const docRows = await tx.select({ id: transactions.id, itemId: transactions.itemId, type: transactions.type })
    .from(transactions)
    .where(and(eq(transactions.documentId, doc.id), eq(transactions.isDeleted, 0), isNull(transactions.reversalOfId)));
  const incomingItemIds = [...new Set(docRows.filter(r => r.type === 'in' || r.type === 'transfer_in').map(r => r.itemId))].sort((a, b) => a - b);
  if (incomingItemIds.length === 0) return;

  const lockedItems = await tx.select({ id: items.id, name: items.name, code: items.code })
    .from(items)
    .where(inArray(items.id, incomingItemIds))
    .orderBy(asc(items.id))
    .for('no key update'); // v8.0.47 (TD-320): هم‌حالت lockStockItems
  const allWarehouses = await tx.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name, isActive: warehouses.isActive })
    .from(warehouses);
  const resolve = createLedgerLocationResolver(allWarehouses);
  const removedIds = new Set(docRows.map(r => r.id));

  for (const item of lockedItems) {
    const res = await tx.execute(sql`
      SELECT t.id, t.type, t.quantity::text AS quantity, to_char(t.date, 'YYYY-MM-DD') AS day, t.location,
             t.document_type, t.document_ref
        FROM transactions t
       WHERE t.item_id = ${item.id} AND ${LEDGER_ROW_FILTER}
       ORDER BY t.date::date, t.id`);
    const broken = firstBrokenWarehouse((res.rows ?? []) as LedgerRow[], removedIds, resolve);
    if (!broken) continue;

    const listed = broken.consumers.slice(0, MAX_LISTED_DOCUMENTS)
      .map(r => `${DOCUMENT_TYPE_TITLES[r.document_type ?? ''] ?? (r.document_type || 'سند')} ${r.document_ref ?? ''} (${isoToJalaliDate(r.day)})`.replace(/\s+/g, ' ').trim());
    const more = broken.consumers.length > MAX_LISTED_DOCUMENTS ? ` و ${broken.consumers.length - MAX_LISTED_DOCUMENTS} سند دیگر` : '';
    throw new InsufficientStockError(
      `ابطال سند «${doc.refNumber ?? doc.id}» ممکن نیست: موجودیِ کالای «${item.name}» (${item.code}) که این سند وارد انبار «${broken.warehouse.code}» کرده ` +
      `با خروج‌های بعدی مصرف شده است و بدون این سند، موجودی آن انبار از ${isoToJalaliDate(broken.day)} تا ${broken.deepest.abs().toString()} واحد منفی می‌شود. ` +
      `اسناد مصرف‌کننده: ${listed.join('، ') || '-'}${more}. ` +
      'برای اصلاح قیمت چنین رسیدی، اختلاف را با سند حسابداری ثبت کنید؛ یا ابتدا اسناد خروجی بعدی را ابطال کنید.',
      { code: 'VOID_BREAKS_STOCK_HISTORY', documentId: doc.id, itemId: item.id, warehouse: broken.warehouse.code, shortfall: broken.deepest.abs().toString() }
    );
  }
}
