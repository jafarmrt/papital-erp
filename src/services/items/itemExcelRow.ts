import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items, itemPrices, warehouses } from '../../db/schema.js';
import { normalizeStrategyTitle, getStrategyCanonicalKey } from '../../utils.js';
import { DocumentService } from '../document.service.js';
import { resolveWarehouseCode } from '../inventory/warehouseResolver.js';
import { money, Money } from '../../lib/money.js';
import { WAC_COLUMNS, extractRowPriceColumns, unknownPriceColumnMessage } from '../../lib/items/excelPriceColumns.js';
import type { ItemImportPermissions } from '../../lib/items/itemImportPermissions.js';

/**
 * v9.0.116 (TD-648): خواندن یک ردیف اکسل کالا و گام‌های موجودی و قیمت آن؛ گردش ردیف در `itemExcelImport.ts` است.
 */

export const EXCEL_DOCUMENT_REF = 'درون‌ریزی اکسل';

export type Row = Record<string, unknown>;
export type ItemRow = typeof items.$inferSelect;
export type Warehouse = typeof warehouses.$inferSelect;

export interface RowFields {
  itemType: 'product' | 'raw_material';
  category: string;
  unit: string;
  reorderPoint: number;
  weightedAverageCost: number;
  image: string;
  color: string;
  size: string;
  weight: number | null;
  material: string;
}

export function readRowFields(row: Row, typeFilter: string | undefined): RowFields {
  const rawType = row['نوع کالا'] || row['نوع'] || row['type'];
  let itemType: 'product' | 'raw_material' = 'product';
  if (rawType === 'ماده اولیه' || rawType === 'raw_material' || typeFilter === 'raw_material') {
    itemType = 'raw_material';
  } else if (rawType === 'محصول نهایی' || rawType === 'product' || typeFilter === 'product') {
    itemType = 'product';
  }
  const weightCell = row['وزن'] || row['weight'];
  return {
    itemType,
    category: String(row['دسته‌بندی'] || row['دسته'] || row['category'] || '').trim(),
    unit: String(row['واحد'] || row['واحد اندازه‌گیری'] || row['unit'] || 'عدد').trim(),
    reorderPoint: Number(row['حد نقطه سفارش (آلارم کسری)'] || row['حد نقطه سفارش'] || row['نقطه سفارش'] || row['reorder_point'] || 0),
    weightedAverageCost: Number(WAC_COLUMNS.map(h => row[h]).find(v => v !== undefined && v !== '') || 0),
    image: String(row['تصویر'] || row['آدرس عکس'] || row['image'] || '').trim(),
    color: String(row['رنگ'] || row['color'] || '').trim(),
    size: String(row['سایز'] || row['size'] || '').trim(),
    weight: weightCell ? Number(weightCell) : null,
    material: String(row['جنس'] || row['material'] || '').trim(),
  };
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

/** کد کالا با قالب نوع خودش؛ پیام خطا یا null */
export function codeFormatError(code: string, itemType: 'product' | 'raw_material', category: string): string | null {
  const isProductType = itemType === 'product' || category.includes('محصول');
  if (isProductType) {
    if (!/^\d{4}-[A-Za-z]+-\d{3}-\d{2}$/.test(code)) {
      return `فرمت کد محصول نهایی نامعتبر است (الگوی صحیح: nnnn-x-nnn-nn). کد ارسال شده: ${code}`;
    }
  } else if (!/^[A-Za-z][A-Za-z0-9\-]*-{1,2}\d{2,3}$/.test(code)) {
    // V10-2.1: قالب تک‌خط جدید (B-H-101) + سازگاری با داده تاریخی دوخط‌تیره (B-H--101)
    return `فرمت کد ماده اولیه نامعتبر است (الگوی صحیح: PREFIX-NNN مانند B-H-101). کد ارسال شده: ${code}`;
  }
  return null;
}
