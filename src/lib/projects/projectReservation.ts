/**
 * v8.0.58 (TD-306، تصمیم مالک محصول — گزینه الف): رزرو پروژه («ثبت نهایی و فریز اقلام») از بخش‌های کنترل موجودی
 * پروژه ساخته می‌شود؛ سرور آن را هنگام ثبت نهایی اجرا می‌کند و `reservedItems` بدنه درخواست را نادیده می‌گیرد
 * (همان قاعده‌ای که پیش‌تر مرورگر در buildReservedItemsToFreeze اجرا می‌کرد). هر قلم به مقدار لازم پروژه رزرو
 * می‌شود، حداکثر تا موجودی کل کالا.
 *
 * v9.0.350 (TD-820، یافته B07-04، تصمیم ت۴ بسته ۷): نیاز هر ردیف پیش از جمع به واحد کالا برده می‌شود. ردیفی که واحدش
 * (پس از حذف فاصله و بی‌توجه به حروف؛ واحد خالی «عدد» است، همان که فرم نشان می‌دهد) با واحد کالا فرق دارد با ضریب تبدیل
 * ثبت‌شده روی خودش تبدیل می‌شود: نیاز به واحد کالا = مقدار لازم ÷ `conversionRate`، به شرط ضریب مثبت و `convertedUnit` خالی
 * یا برابر واحد کالا؛ `convertedQty` (گردشده) خوانده نمی‌شود. ردیف با واحد دیگر و بی تبدیل معتبر در
 * `unitMismatches` می‌آید و سرور ثبت نهایی را رد می‌کند. نیازها پس از تبدیل به ازای شناسه کالای تطبیق‌یافته جمع می‌شوند.
 *
 * v9.0.351 (TD-819، یافته B07-03، تصمیم ت۳ بسته ۷): رزرو هر کالا = min(نیاز، موجودی کل − رزرو دیگران) (اول بیاید، اول ببرد)؛
 * رزرو دیگران (پیش‌فاکتورهای فروش و پروژه‌های ثبت نهایی‌شده دیگر) را سرور می‌دهد. هر کالایی که کمتر از نیازش رزرو شد در
 * `shortages` می‌آید (کالای بی موجودی هم، با رزرو صفر).
 */

import { fin, type FinancialDecimal } from '../financialDecimal.js';
import { findProjectItemMatch } from './projectItemMatch.js';

/** کالای انبار برای تطبیق ردیف‌های کنترل موجودی (findProjectItemMatch: کد، سپس نام دقیق) */
export interface ReservationStockItem {
  id: number;
  code?: string | null;
  name?: string | null;
  category?: string | null;
  unit?: string | null;
  currentStock: number;
}

export interface ProjectReservedItem {
  itemId?: number;
  itemCode: string;
  itemName: string;
  category?: string;
  reservedQty: number;
  /** نیاز پروژه به واحد کالا (پس از تبدیل) */
  originalQty: number;
  unit: string;
  originalUnit?: string;
  /** ضریب تبدیل وقتی همه ردیف‌های این کالا با یک واحد دیگر و یک ضریب آمده‌اند (هر واحد کالا چند `conversionUnit`) */
  conversionRate?: number;
  conversionUnit?: string;
  reservedAt: string;
}

/** ردیفی که واحدش با واحد کالا فرق دارد و تبدیل معتبر ندارد */
export interface ReservationUnitMismatch {
  itemId: number;
  itemCode: string;
  itemName: string;
  rowUnit: string;
  itemUnit: string;
  section?: string;
}

/** کالایی که ثبت نهایی کمتر از نیازش رزرو کرد (به واحد کالا) */
export interface ReservationShortage {
  itemId: number;
  itemCode: string;
  itemName: string;
  unit: string;
  requiredQty: number;
  reservedQty: number;
  shortQty: number;
  /** موجودی کل کالا هنگام ثبت نهایی */
  stock: number;
  /** رزرو پیش‌فاکتورها و پروژه‌های دیگر هنگام ثبت نهایی */
  reservedByOthers: number;
}

export interface ProjectReservationPlan {
  reserved: ProjectReservedItem[];
  shortages: ReservationShortage[];
  unitMismatches: ReservationUnitMismatch[];
}

export interface ProjectReservationOptions {
  /** رزرو دیگران به ازای شناسه کالا (پیش‌فاکتورهای فروش و پروژه‌های ثبت نهایی‌شده دیگر) */
  reservedByOthers?: ReadonlyMap<number, number>;
}

type Row = Record<string, unknown>;

const asRow = (v: unknown): Row | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null);
const asRows = (v: unknown): Row[] => (Array.isArray(v) ? v.map(asRow).filter((r): r is Row => r !== null) : []);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const optText = (v: unknown): string | undefined => text(v) || undefined;

/** کلید واحد: بی فاصله دو سو و بی‌توجه به حروف */
export const unitKey = (unit: unknown): string => text(unit).toLowerCase();

/** واحد ردیف کنترل موجودی؛ خالی «عدد» است، همان که فرم پروژه نشان می‌دهد */
const DEFAULT_ROW_UNIT = 'عدد';

/** یک ردیف نیاز پروژه پیش از تطبیق با کالا */
interface NeedRow {
  code: string;
  name: string;
  qty: number;
  unit: string;
  category?: string;
  conversionRate?: unknown;
  convertedUnit?: unknown;
  section?: string;
}

interface ItemNeed {
  item: ReservationStockItem;
  qty: FinancialDecimal;
  category?: string;
  /** واحد و ضریب ردیف‌های تبدیل‌شده؛ بیش از یک جفت یعنی ضریب روی ردیف رزرو نوشته نمی‌شود */
  conversions: Set<string>;
  firstConversion?: { unit: string; rate: number };
  rowUnits: Set<string>;
}

/** ردیف‌های نیاز از بخش‌ها (per_item و global) و اقلام دستی رزروشده */
function collectNeedRows(sections: unknown, products: unknown, manualPurchaseItems: unknown): NeedRow[] {
  const rows: NeedRow[] = [];
  const productList = asRows(products);
  const push = (r: Row, qty: number, name: unknown, category: string | undefined, section?: string) => {
    const code = text(r.itemCode);
    const nm = text(name);
    if ((!code && !nm) || !(qty > 0)) return;
    rows.push({ code, name: nm, qty, unit: text(r.unit) || DEFAULT_ROW_UNIT, category, conversionRate: r.conversionRate, convertedUnit: r.convertedUnit, section });
  };

  for (const sec of asRows(sections)) {
    const title = optText(sec.title);
    const perItemResults = asRow(sec.perItemResults);
    if (sec.checkType === 'per_item' && perItemResults) {
      for (const prod of productList) {
        const prodRes = asRow(perItemResults[text(prod.id)]) || {};
        const results = Object.values(prodRes).map(asRow).filter((r): r is Row => r !== null);
        const list = results.length > 0
          ? results
          : asRows(sec.itemsSchema).map(s => ({ itemCode: s.itemCode, name: s.name, unit: s.unit, requiredQty: 1 }) as Row);
        for (const r of list) {
          push(r, Number(r.requiredQty !== undefined ? r.requiredQty : 1), r.name, optText(r.category) || title, title);
        }
      }
    } else if (sec.checkType === 'global') {
      for (const g of asRows(sec.globalItems)) {
        push(g, Number(g.requiredQty || 0), g.name, optText(g.category) || title, title);
      }
    }
  }

  for (const m of asRows(manualPurchaseItems)) {
    if (m.procurementStatus === 'reserved' || m.toPurchaseQty === 0) {
      push(m, Number(m.totalRequiredQty || 0), m.itemName, optText(m.category) || 'اقلام دستی', 'اقلام دستی');
    }
  }
  return rows;
}

/** مقدار ردیف به واحد کالا، یا null وقتی واحد فرق دارد و تبدیل معتبر نیست */
function needInItemUnit(row: NeedRow, itemUnit: string): { qty: number; conversion?: { unit: string; rate: number } } | null {
  const rowUnit = unitKey(row.unit);
  if (!itemUnit || rowUnit === itemUnit) return { qty: row.qty };
  const rate = Number(row.conversionRate);
  const target = unitKey(row.convertedUnit);
  if (!(Number.isFinite(rate) && rate > 0) || (target && target !== itemUnit)) return null;
  return { qty: fin(row.qty).divide(rate, 4).toNumber(), conversion: { unit: row.unit, rate } };
}

export function planProjectReservation(
  sections: unknown,
  products: unknown,
  stockItems: ReservationStockItem[],
  manualPurchaseItems: unknown,
  reservedAt: string,
  options: ProjectReservationOptions = {},
): ProjectReservationPlan {
  const needs = new Map<number, ItemNeed>();
  const mismatches = new Map<string, ReservationUnitMismatch>();

  for (const row of collectNeedRows(sections, products, manualPurchaseItems)) {
    // v9.0.332 (TD-749، TD-768): قاعده مشترک تطبیق با مرورگر؛ کد کالا بر نام کالای دیگر مقدم است
    const match = findProjectItemMatch({ code: row.code, name: row.name }, stockItems);
    if (!match) continue;
    const itemUnit = unitKey(match.unit);
    const converted = needInItemUnit(row, itemUnit);
    if (!converted) {
      const key = `${match.id}|${unitKey(row.unit)}`;
      if (!mismatches.has(key)) {
        mismatches.set(key, { itemId: match.id, itemCode: match.code || row.code, itemName: match.name || row.name, rowUnit: row.unit, itemUnit: text(match.unit), section: row.section });
      }
      continue;
    }
    if (!(converted.qty > 0)) continue;
    const cur = needs.get(match.id) || { item: match, qty: fin(0), category: row.category, conversions: new Set<string>(), rowUnits: new Set<string>() };
    cur.qty = cur.qty.add(converted.qty);
    cur.rowUnits.add(unitKey(row.unit));
    if (converted.conversion) {
      cur.conversions.add(`${unitKey(converted.conversion.unit)}|${converted.conversion.rate}`);
      cur.firstConversion = cur.firstConversion || converted.conversion;
    }
    needs.set(match.id, cur);
  }

  const reserved: ProjectReservedItem[] = [];
  const shortages: ReservationShortage[] = [];
  for (const need of needs.values()) {
    const { item } = need;
    const required = need.qty.round(4).toNumber();
    const stock = Number(item.currentStock) || 0;
    const others = Math.max(0, Number(options.reservedByOthers?.get(item.id)) || 0);
    const free = Math.max(0, fin(stock).subtract(others).toNumber());
    const reservedQty = Math.min(free, required);
    const unit = text(item.unit) || DEFAULT_ROW_UNIT;
    if (reservedQty < required) {
      shortages.push({
        itemId: item.id, itemCode: text(item.code), itemName: text(item.name), unit, requiredQty: required, reservedQty,
        shortQty: fin(required).subtract(reservedQty).toNumber(), stock, reservedByOthers: others,
      });
    }
    if (reservedQty <= 0) continue;
    const single = need.conversions.size === 1 && need.rowUnits.size === 1 ? need.firstConversion : undefined;
    reserved.push({
      itemId: item.id,
      itemCode: text(item.code),
      itemName: text(item.name),
      category: item.category || need.category,
      reservedQty,
      originalQty: required,
      unit,
      originalUnit: unit,
      ...(single ? { conversionRate: single.rate, conversionUnit: single.unit } : {}),
      reservedAt,
    });
  }
  return { reserved, shortages, unitMismatches: [...mismatches.values()] };
}

export function buildProjectReservation(
  sections: unknown,
  products: unknown,
  stockItems: ReservationStockItem[],
  manualPurchaseItems: unknown,
  reservedAt: string
): ProjectReservedItem[] {
  return planProjectReservation(sections, products, stockItems, manualPurchaseItems, reservedAt).reserved;
}
