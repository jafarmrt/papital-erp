import { and, asc, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items, itemPrices, warehouses } from '../../db/schema.js';
import { normalizeStrategyTitle, getStrategyCanonicalKey } from '../../utils.js';
import { DocumentService } from '../document.service.js';
import { money, Money } from '../../lib/money.js';
import { WAC_COLUMNS, extractRowPriceColumns, unknownPriceColumnMessage } from '../../lib/items/excelPriceColumns.js';
import type { ItemImportPermissions } from '../../lib/items/itemImportPermissions.js';
export { codeFormatError } from '../../lib/items/itemCodeFormat.js';

/**
 * v9.0.116 (TD-648): خواندن یک ردیف اکسل کالا و گام‌های موجودی و قیمت آن؛ گردش ردیف در `itemExcelImport.ts` است.
 */

export const EXCEL_DOCUMENT_REF = 'درون‌ریزی اکسل';

export type Row = Record<string, unknown>;
export type ItemRow = typeof items.$inferSelect;
export type Warehouse = typeof warehouses.$inferSelect;

/**
 * v9.0.117 (TD-650، تصمیم ت۳ الف): مشخصات یک ردیف؛ ستونِ نبود یا سلول خالی `undefined` است و برای کالای موجود یعنی
 * «بی‌تغییر». پیش‌تر نبود ستون واحد «عدد»، نقطه سفارش ۰ و نوع «محصول» می‌شد و فایل ناقص مشخصات کالا را بازنویسی می‌کرد.
 */
export interface RowFields {
  /** نوع فقط از ستون نوع؛ نوع کالای موجود بی این ستون همان نوع خودش است */
  itemType?: 'product' | 'raw_material';
  category?: string;
  unit?: string;
  reorderPoint?: number;
  weightedAverageCost: number;
  image?: string;
  color?: string;
  size?: string;
  weight?: number;
  material?: string;
}

export function isBlankCell(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/** نخستین سلول پرِ این سرستون‌ها */
function cell(row: Row, headers: string[]): unknown {
  for (const h of headers) {
    if (!isBlankCell(row[h])) return row[h];
  }
  return undefined;
}

function textCell(row: Row, headers: string[]): string | undefined {
  const v = cell(row, headers);
  return v === undefined ? undefined : String(v).trim();
}

/** عدد سلول؛ سلول خالی یا ناعددی `undefined` (بی‌تغییر) */
function numberCell(row: Row, headers: string[]): number | undefined {
  const v = cell(row, headers);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

function typeCell(row: Row): 'product' | 'raw_material' | undefined {
  const rawType = textCell(row, ['نوع کالا', 'نوع', 'type']);
  if (rawType === 'ماده اولیه' || rawType === 'raw_material') return 'raw_material';
  if (rawType === 'محصول نهایی' || rawType === 'product') return 'product';
  return undefined;
}

export function readRowFields(row: Row): RowFields {
  return {
    itemType: typeCell(row),
    category: textCell(row, ['دسته‌بندی', 'دسته', 'category']),
    unit: textCell(row, ['واحد', 'واحد اندازه‌گیری', 'unit']),
    reorderPoint: numberCell(row, ['حد نقطه سفارش (آلارم کسری)', 'حد نقطه سفارش', 'نقطه سفارش', 'reorder_point']),
    weightedAverageCost: numberCell(row, [...WAC_COLUMNS]) ?? 0,
    image: textCell(row, ['تصویر', 'آدرس عکس', 'image']),
    color: textCell(row, ['رنگ', 'color']),
    size: textCell(row, ['سایز', 'size']),
    weight: numberCell(row, ['وزن', 'weight']),
    material: textCell(row, ['جنس', 'material']),
  };
}

/** نوع کالای تازه: ستون نوع، وگرنه پالایش صفحه، وگرنه محصول */
export function newItemType(fields: RowFields, typeFilter: string | undefined): 'product' | 'raw_material' {
  return fields.itemType ?? (typeFilter === 'raw_material' ? 'raw_material' : 'product');
}

/**
 * v9.0.119 (TD-649، تصمیم ت۳ الف): ستون‌های موجودی یک ردیف. `byWarehouse` فقط انبارهایی که سلولشان پر است؛ `total` ستون
 * «موجودی کل» اگر پر است. پیش‌تر «موجودی کل» بی ستون انبار در انبار پیش‌فرض گذاشته و اختلاف همان انبار اعمال می‌شد:
 * کالای ۱۰ واحدی «انبار دوم» با فایل «موجودی کل = 10» به ۲۰ می‌رسید.
 */
export interface RowStock {
  byWarehouse: Record<string, number>;
  total?: number;
}

export function readRowStock(row: Row, whs: Warehouse[]): RowStock {
  const byWarehouse: Record<string, number> = {};
  for (const w of whs) {
    const v = numberCell(row, [`موجودی انبار ${w.name}`, `موجودی ${w.name}`, w.name, `stock_${w.code}`]);
    if (v !== undefined) byWarehouse[w.code] = v;
  }
  return { byWarehouse, total: numberCell(row, ['موجودی کل', 'موجودی فعلی', 'موجودی']) };
}

/** اختلاف موجودی هر انبار که ورود باید ثبت کند */
export interface StockChange {
  whCode: string;
  diff: number;
}

const QTY_EPSILON = 1e-6;
const sameQty = (a: number, b: number) => Math.abs(a - b) < QTY_EPSILON;

/**
 * گردش‌های موجودی ردیف، یا پیام خطای ردیف (آن‌گاه هیچ بخشی از ردیف ثبت نمی‌شود):
 * - ستون انبار: موجودی همان انبارها؛ انبارهای دیگر بی‌تغییر؛ «موجودی کل» پر باید با جمع همه انبارها برابر باشد.
 * - فقط «موجودی کل»: کالای تازه در انبار پیش‌فرض؛ کالای موجود اگر کل برابر است بی‌تغییر، اگر همه موجودی‌اش در انبار
 *   پیش‌فرض است همان انبار، وگرنه خطای «موجودی هر انبار لازم است».
 * - موجودی منفی و تغییر موجودی انبار غیرفعال خطای ردیف است (پیش‌تر کل ورود با خطای پایگاه‌داده برمی‌گشت).
 */
export function planStockChanges(
  stock: RowStock,
  existing: { byCode: Record<string, number>; total: number },
  whs: Warehouse[],
  defaultWhCode: string,
): { changes: StockChange[] } | { error: string } {
  const targets: Record<string, number> = { ...existing.byCode };
  const explicit = Object.keys(stock.byWarehouse);
  if (explicit.length > 0) {
    for (const code of explicit) targets[code] = stock.byWarehouse[code];
    const sum = Object.values(targets).reduce((a, b) => a + b, 0);
    if (stock.total !== undefined && !sameQty(sum, stock.total)) {
      return { error: `«موجودی کل» (${stock.total}) با جمع موجودی انبارها (${sum}) برابر نیست. ردیف ثبت نشد.` };
    }
  } else if (stock.total !== undefined && !sameQty(stock.total, existing.total)) {
    const inDefault = existing.byCode[defaultWhCode] ?? 0;
    if (!sameQty(inDefault, existing.total)) {
      return { error: 'این کالا در چند انبار موجودی دارد؛ ستون موجودی هر انبار لازم است و «موجودی کل» تنها پذیرفته نمی‌شود. ردیف ثبت نشد.' };
    }
    targets[defaultWhCode] = stock.total;
  }
  const changes: StockChange[] = [];
  for (const [whCode, qty] of Object.entries(targets)) {
    const diff = qty - (existing.byCode[whCode] ?? 0);
    if (sameQty(diff, 0)) continue;
    if (qty < 0) return { error: `موجودی منفی (${qty}) پذیرفته نیست. ردیف ثبت نشد.` };
    const wh = whs.find(w => w.code === whCode);
    if (wh && wh.isActive !== 1) return { error: `انبار «${wh.name}» غیرفعال است و موجودی آن از اکسل تغییر نمی‌کند. ردیف ثبت نشد.` };
    changes.push({ whCode, diff });
  }
  return { changes };
}

export interface MovementContext {
  itemId: number;
  price: Money;
  date: string;
  user: string;
}

export async function applyStockChange(tx: DbExecutor, ctx: MovementContext, change: StockChange, notes: { in: string; out: string }): Promise<number> {
  const movement = await DocumentService.applyStockMovement(tx, {
    itemId: ctx.itemId,
    inOut: change.diff > 0 ? 'in' : 'out',
    quantity: Math.abs(change.diff),
    price: ctx.price,
    date: ctx.date,
    documentType: 'audit',
    documentRef: EXCEL_DOCUMENT_REF,
    user: ctx.user,
    targetLoc: change.whCode,
    notes: change.diff > 0 ? notes.in : notes.out,
  });
  return movement.transactionId;
}

/** v9.0.116 (TD-648): بخش‌هایی از تغییر موجودی که کاربر مجوزش را ندارد */
export function deniedStockPermissions(changes: StockChange[], perms: ItemImportPermissions): Array<keyof ItemImportPermissions> {
  const denied: Array<keyof ItemImportPermissions> = [];
  if (!perms.stockIn && changes.some(c => c.diff > 0)) denied.push('stockIn');
  if (!perms.stockOut && changes.some(c => c.diff < 0)) denied.push('stockOut');
  return denied;
}

export const ITEM_FIELD_KEYS = ['name', 'type', 'unit', 'category', 'reorderPoint', 'weightedAverageCost', 'color', 'size', 'weight', 'material', 'image'] as const;

export function sameFieldValue(a: unknown, b: unknown): boolean {
  if (a instanceof Money || b instanceof Money) return money(a as number).equals(money(b as number));
  return String(a ?? '') === String(b ?? '');
}

export type RowPrice = { price: number; currency: string };

export function readRowPrices(row: Row, strategies: string[], push: (message: string) => void): Map<string, RowPrice> {
  // v9.0.114 (TD-647، ت۱ الف): فقط فهرست‌های قیمت تنظیم‌شده قیمت‌اند؛ ستون دیگرِ «قیمت …» خطای ردیف می‌گیرد و
  // نادیده گرفته می‌شود (پیش‌تر «قیمت میانگین خرید (WAC)» فایل خروجی فهرست قیمت فروش می‌شد)
  const extracted = new Map<string, RowPrice>();
  const priceColumns = extractRowPriceColumns(row, strategies);
  for (const column of priceColumns.unknownColumns) push(unknownPriceColumnMessage(column));
  for (const cell of priceColumns.prices) {
    if (!isNaN(Number(cell.value)) && Number(cell.value) >= 0) {
      extracted.set(cell.title, { price: Number(cell.value), currency: cell.currency });
    }
  }
  return extracted;
}

/** قیمت‌هایی از ردیف که با قیمت فعال فعلی فرق دارند (TD-662: قیمت بی‌تغییر دوباره نوشته نمی‌شود) */
export async function changedRowPrices(tx: DbExecutor, itemId: number, prices: Map<string, RowPrice>) {
  if (prices.size === 0) return [];
  const existingList = await tx.select().from(itemPrices)
    .where(and(eq(itemPrices.itemId, itemId), eq(itemPrices.isDeleted, 0)))
    .for('update');
  const changed: Array<{ title: string; price: RowPrice; replaces: number[] }> = [];
  for (const [normKey, pObj] of prices.entries()) {
    const cleanTitle = normalizeStrategyTitle(normKey);
    const canKey = getStrategyCanonicalKey(cleanTitle);
    const matchingActive = existingList.filter(p => getStrategyCanonicalKey(p.title) === canKey);
    // v9.0.115 (TD-662): قیمت بی‌تغییر (همان مبلغ و ارز) دوباره نوشته نمی‌شود؛ پیش‌تر هر ورود همان فایل هر قیمت را نرم
    // حذف و دوباره درج می‌کرد و تاریخچه قیمت با ردیف‌های تکراری پر می‌شد
    if (matchingActive.length === 1 && matchingActive[0].price.equals(money(pObj.price)) && (matchingActive[0].currency || 'IRR') === pObj.currency) {
      continue;
    }
    changed.push({ title: cleanTitle, price: pObj, replaces: matchingActive.map(m => m.id) });
  }
  return changed;
}

export async function saveRowPrices(tx: DbExecutor, itemId: number, changed: Awaited<ReturnType<typeof changedRowPrices>>): Promise<number> {
  const nowIso = new Date().toISOString();
  for (const c of changed) {
    for (const id of c.replaces) {
      await tx.update(itemPrices).set({ isDeleted: 1, updatedAt: nowIso }).where(eq(itemPrices.id, id));
    }
    await tx.insert(itemPrices).values({
      itemId,
      title: c.title,
      price: money(c.price.price),
      currency: c.price.currency,
      createdAt: nowIso,
      updatedAt: nowIso,
      isDeleted: 0,
    });
  }
  return changed.length;
}

/**
 * v9.0.118 (TD-651): کالای ردیف فقط با کد، قفل‌شده `FOR UPDATE`: کد دقیق، وگرنه تنها کالایی که کدش جز در بزرگی و کوچکی
 * حروف برابر است. چند کالای هم‌حرف `ambiguous` است (کدهای پیشین؛ ایندکس یکتای ت۴ جلوی کد تازه را می‌گیرد).
 */
export async function findItemByCode(tx: DbExecutor, code: string): Promise<{ item: ItemRow | null; ambiguous: string[] }> {
  const [exact] = await tx.select().from(items).where(and(eq(items.code, code), eq(items.isDeleted, 0))).for('update');
  if (exact) return { item: exact, ambiguous: [] };
  const similar = await tx.select().from(items)
    .where(and(sql`upper(${items.code}) = upper(${code})`, eq(items.isDeleted, 0)))
    .orderBy(asc(items.id))
    .for('update');
  if (similar.length > 1) return { item: null, ambiguous: similar.map(i => i.code) };
  return { item: similar[0] ?? null, ambiguous: [] };
}
