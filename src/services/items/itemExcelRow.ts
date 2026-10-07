import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items, itemPrices, warehouses } from '../../db/schema.js';
import { normalizeStrategyTitle, getStrategyCanonicalKey } from '../../utils.js';
import { DocumentService } from '../document.service.js';
import { resolveWarehouseCode } from '../inventory/warehouseResolver.js';
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

export interface RowStock {
  stockValues: Record<string, number>;
  currentStock: number;
  hasCustomStockInRow: boolean;
}

export function readRowStock(row: Row, whs: Warehouse[], defaultWhCode: string): RowStock {
  const stockValues: Record<string, number> = {};
  let computedStock = 0;
  let hasCustomStockInRow = false;
  for (const w of whs) {
    const val = row[`موجودی انبار ${w.name}`] ?? row[`موجودی ${w.name}`] ?? row[w.name] ?? row[`stock_${w.code}`];
    if (val !== undefined && val !== '' && !isNaN(Number(val))) {
      stockValues[w.code] = Number(val);
      computedStock += Number(val);
      hasCustomStockInRow = true;
    }
  }
  const currentStock = Number(row['موجودی کل'] || row['موجودی فعلی'] || row['موجودی']) || computedStock;
  const totalWhStock = Object.values(stockValues).reduce((a, b) => a + Number(b || 0), 0);
  if (totalWhStock === 0 && currentStock > 0) {
    stockValues[defaultWhCode] = currentStock;
    hasCustomStockInRow = true;
  }
  return { stockValues, currentStock, hasCustomStockInRow };
}

/** اختلاف موجودی هر انبار که ورود باید ثبت کند */
export interface StockChange {
  whCode: string;
  diff: number;
}

export async function plannedStockChanges(tx: DbExecutor, stock: RowStock, existingStocks: Record<string, number>, existingTotal: number): Promise<StockChange[]> {
  if (stock.hasCustomStockInRow && Object.keys(stock.stockValues).length > 0) {
    return Object.keys(stock.stockValues)
      .map(whCode => ({ whCode, diff: Number(stock.stockValues[whCode] || 0) - Number(existingStocks[whCode] || 0) }))
      .filter(c => c.diff !== 0);
  }
  const finalStock = (stock.hasCustomStockInRow ? stock.currentStock : existingTotal) ?? 0;
  const diff = finalStock - existingTotal;
  return diff === 0 ? [] : [{ whCode: await resolveWarehouseCode(tx, ''), diff }];
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

export const ITEM_FIELD_KEYS = ['name', 'code', 'type', 'unit', 'category', 'reorderPoint', 'weightedAverageCost', 'color', 'size', 'weight', 'material', 'image'] as const;

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
