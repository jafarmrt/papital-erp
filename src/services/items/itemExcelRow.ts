import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items, itemPrices, warehouses } from '../../db/schema.js';
import { normalizeStrategyTitle, getStrategyCanonicalKey } from '../../utils.js';
import { DocumentService } from '../document.service.js';
import { money, Money } from '../../lib/money.js';
import { ITEM_WAC_COLUMN, WAC_COLUMNS, extractRowPriceColumns, unknownPriceColumnMessage } from '../../lib/items/excelPriceColumns.js';
import { REORDER_POINT_COLUMNS } from '../../lib/items/itemExcelColumns.js';
import { parsePriceAmount, priceCurrencyOf } from '../../lib/items/priceInput.js';
import type { ItemImportPermissions } from '../../lib/items/itemImportPermissions.js';
import { newItemTypeOf, parseItemTypeCell, parseNumberCell } from '../../lib/items/itemExcelCells.js';
import { PRODUCT_CARD_COLUMNS } from '../../lib/media/productCard.js';
import { productCardValues, type ProductCardValues } from '../media/productCardWrite.js';
import { errorMessageOf } from '../../utils.js';
export { codeFormatError } from '../../lib/items/itemCodeFormat.js';

/**
 * v9.0.154 (TD-648): خواندن یک ردیف اکسل کالا و گام‌های موجودی و قیمت آن؛ گردش ردیف در `itemExcelImport.ts` است.
 */

export const EXCEL_DOCUMENT_REF = 'درون‌ریزی اکسل';

export type Row = Record<string, unknown>;
export type ItemRow = typeof items.$inferSelect;
export type Warehouse = typeof warehouses.$inferSelect;

/**
 * v9.0.155 (TD-650، تصمیم ت۳ الف): مشخصات یک ردیف؛ ستونِ نبود یا سلول خالی `undefined` است و برای کالای موجود یعنی
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
  /** v10.0.22 (N-05): product card cells; a blank cell is missing here and keeps the stored value */
  card: ProductCardValues;
  /** v10.0.1 (TD-1010) / v10.0.2 (TD-1011): خطای نخستین سلول نادرست ردیف؛ آن‌گاه هیچ بخشی از ردیف ثبت نمی‌شود */
  cellError?: string;
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

/**
 * عدد سلول؛ سلول خالی `undefined` (بی‌تغییر). v10.0.2 (TD-1011): ارقام فارسی و جداکننده هزارگان خوانده می‌شوند و متنی
 * که عدد نیست در `errors` می‌رود (خطای ردیف)؛ پیش‌تر بی‌صدا `undefined` می‌شد.
 */
function numberCell(row: Row, headers: readonly string[], errors: string[]): number | undefined {
  const parsed = parseNumberCell(row, headers);
  if (parsed.error) errors.push(parsed.error);
  return parsed.value;
}

/** v10.0.22 (N-05): the product card cells of a row, read with the item form's rules; an invalid cell is a row error */
function readRowProductCard(row: Row, errors: string[]): ProductCardValues {
  const C = PRODUCT_CARD_COLUMNS;
  const input = {
    collections: cell(row, [C.collections, 'collections']),
    design_year: cell(row, [C.designYear, 'design_year']),
    transfer_code: textCell(row, [C.transferCode, 'transfer_code']),
    product_description: textCell(row, [C.productDescription, 'product_description']),
    technical_notes: textCell(row, [C.technicalNotes, 'technical_notes']),
  };
  try {
    return productCardValues(input);
  } catch (err) {
    errors.push(errorMessageOf(err));
    return {};
  }
}

export function readRowFields(row: Row): RowFields {
  // v10.0.1 (TD-1010): «مواد اولیه» و «محصول» هم خوانده می‌شوند و نوشته ناشناخته خطای ردیف است، نه «محصول» بی‌صدا
  const type = parseItemTypeCell(row);
  const errors: string[] = type.error ? [type.error] : [];
  const fields: RowFields = {
    itemType: type.value,
    category: textCell(row, ['دسته‌بندی', 'دسته', 'category']),
    unit: textCell(row, ['واحد', 'واحد اندازه‌گیری', 'unit']),
    reorderPoint: numberCell(row, REORDER_POINT_COLUMNS, errors),
    weightedAverageCost: numberCell(row, WAC_COLUMNS, errors) ?? 0,
    image: textCell(row, ['تصویر', 'آدرس عکس', 'image']),
    color: textCell(row, ['رنگ', 'color']),
    size: textCell(row, ['سایز', 'size']),
    weight: numberCell(row, ['وزن', 'weight'], errors),
    material: textCell(row, ['جنس', 'material']),
    card: readRowProductCard(row, errors),
  };
  return { ...fields, cellError: errors[0] };
}

/** نوع کالای تازه: ستون نوع، وگرنه پالایش صفحه، وگرنه محصول */
export function newItemType(fields: RowFields, typeFilter: string | undefined): 'product' | 'raw_material' {
  return newItemTypeOf(fields.itemType, typeFilter);
}

/**
 * v9.0.157 (TD-649، تصمیم ت۳ الف): ستون‌های موجودی یک ردیف. `byWarehouse` فقط انبارهایی که سلولشان پر است؛ `total` ستون
 * «موجودی کل» اگر پر است. پیش‌تر «موجودی کل» بی ستون انبار در انبار پیش‌فرض گذاشته و اختلاف همان انبار اعمال می‌شد:
 * کالای ۱۰ واحدی «انبار دوم» با فایل «موجودی کل = 10» به ۲۰ می‌رسید.
 */
export interface RowStock {
  byWarehouse: Record<string, number>;
  total?: number;
  /** v10.0.2 (TD-1011): سلول موجودی‌ای که عدد نیست؛ آن‌گاه ردیف ثبت نمی‌شود */
  cellError?: string;
}

export function readRowStock(row: Row, whs: Warehouse[]): RowStock {
  const byWarehouse: Record<string, number> = {};
  const errors: string[] = [];
  for (const w of whs) {
    const v = numberCell(row, [`موجودی انبار ${w.name}`, `موجودی ${w.name}`, w.name, `stock_${w.code}`], errors);
    if (v !== undefined) byWarehouse[w.code] = v;
  }
  const total = numberCell(row, ['موجودی کل', 'موجودی فعلی', 'موجودی'], errors);
  return { byWarehouse, total, cellError: errors[0] };
}

/** اختلاف موجودی هر انبار که ورود باید ثبت کند */
export interface StockChange {
  whCode: string;
  diff: number;
}

/**
 * v10.0.13 (TD-1012، تصمیم مالک محصول در D-01): کالایی که پس از این ردیف میانگین موزون بها ندارد موجودی تازه از اکسل
 * نمی‌گیرد؛ پیش‌تر با بهای صفر وارد می‌شد، سند افتتاحیه‌اش صفر بود و هیچ فروش یا حواله‌ای را نمی‌پذیرفت (TD-214 / P2-4).
 * کاهش موجودی (شمارش) همچنان با بهای صفر ثبت می‌شود.
 */
export function stockWithoutCostError(item: { name: string; code: string }, changes: readonly StockChange[], itemWac: Money): string | null {
  if (itemWac.isPositive() || !changes.some(c => c.diff > 0)) return null;
  return `کالای «${item.name}» (${item.code}) میانگین موزون بها ندارد و موجودی بی‌بها وارد انبار نمی‌شود، ` +
    `چون چنین کالایی هیچ فروش یا حواله‌ای را نمی‌پذیرد. ستون «${ITEM_WAC_COLUMN}» را پر کنید. ردیف ثبت نشد.`;
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

/** v9.0.154 (TD-648): بخش‌هایی از تغییر موجودی که کاربر مجوزش را ندارد */
export function deniedStockPermissions(changes: StockChange[], perms: ItemImportPermissions): Array<keyof ItemImportPermissions> {
  const denied: Array<keyof ItemImportPermissions> = [];
  if (!perms.stockIn && changes.some(c => c.diff > 0)) denied.push('stockIn');
  if (!perms.stockOut && changes.some(c => c.diff < 0)) denied.push('stockOut');
  return denied;
}

export const ITEM_FIELD_KEYS = [
  'name', 'type', 'unit', 'category', 'reorderPoint', 'weightedAverageCost', 'color', 'size', 'weight', 'material', 'image',
  'collections', 'designYear', 'transferCode', 'productDescription', 'technicalNotes',
] as const;

export function sameFieldValue(a: unknown, b: unknown): boolean {
  if (a instanceof Money || b instanceof Money) return money(a as number).equals(money(b as number));
  return String(a ?? '') === String(b ?? '');
}

export type RowPrice = { price: string; currency: string };

/**
 * قیمت‌های ردیف، یا null وقتی ردیف رد می‌شود. v9.0.176 (TD-657 بخش قیمت، ت۹ الف): هر قیمت پرشده عددی بزرگ‌تر از صفر با
 * ارزی از فهرست AGENTS §6 است (ارقام فارسی خوانده می‌شوند)؛ وگرنه کل ردیف پیش از هر نوشتن رد می‌شود. پیش‌تر قیمت صفر
 * ذخیره، «abc» یا «۲٬۵۰۰٬۰۰۰» بی‌صدا نادیده و ارز «XYZ» پذیرفته می‌شد.
 */
export function readRowPrices(row: Row, strategies: string[], push: (message: string) => void): Map<string, RowPrice> | null {
  // v9.0.152 (TD-647، ت۱ الف): فقط فهرست‌های قیمت تنظیم‌شده قیمت‌اند؛ ستون دیگرِ «قیمت …» خطای ردیف می‌گیرد و
  // نادیده گرفته می‌شود (پیش‌تر «قیمت میانگین خرید (WAC)» فایل خروجی فهرست قیمت فروش می‌شد)
  const extracted = new Map<string, RowPrice>();
  const priceColumns = extractRowPriceColumns(row, strategies);
  for (const column of priceColumns.unknownColumns) push(unknownPriceColumnMessage(column));
  const invalid: string[] = [];
  for (const cell of priceColumns.prices) {
    const amount = parsePriceAmount(cell.value);
    const currency = priceCurrencyOf(cell.currency);
    if (amount === null) invalid.push(`قیمت «${cell.title}» باید عددی بزرگ‌تر از صفر باشد (مقدار فایل: «${String(cell.value)}»)`);
    else if (currency === null) invalid.push(`ارز «${cell.currency}» برای قیمت «${cell.title}» پشتیبانی نمی‌شود؛ یکی از IRR، USD، EUR، AED یا GBP را بنویسید`);
    else extracted.set(cell.title, { price: amount, currency });
  }
  if (invalid.length > 0) {
    push(`${invalid.join('؛ ')}. این ردیف ثبت نشد.`);
    return null;
  }
  return extracted;
}

/** قیمت‌هایی از ردیف که با قیمت فعال فعلی فرق دارند (TD-662: قیمت بی‌تغییر دوباره نوشته نمی‌شود) */
export async function changedRowPrices(tx: DbExecutor, itemId: number, prices: Map<string, RowPrice>, isNewItem = false) {
  if (prices.size === 0) return [];
  // v9.0.206 (TD-663): کالایی که همین ردیف ساخته قیمتی ندارد؛ خواندنش لازم نیست
  const existingList = isNewItem ? [] : await tx.select().from(itemPrices)
    .where(and(eq(itemPrices.itemId, itemId), eq(itemPrices.isDeleted, 0)))
    .for('update');
  const changed: Array<{ title: string; price: RowPrice; replaces: number[] }> = [];
  for (const [normKey, pObj] of prices.entries()) {
    const cleanTitle = normalizeStrategyTitle(normKey);
    const canKey = getStrategyCanonicalKey(cleanTitle);
    const matchingActive = existingList.filter(p => getStrategyCanonicalKey(p.title) === canKey);
    // v9.0.153 (TD-662): قیمت بی‌تغییر (همان مبلغ و ارز) دوباره نوشته نمی‌شود؛ پیش‌تر هر ورود همان فایل هر قیمت را نرم
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
