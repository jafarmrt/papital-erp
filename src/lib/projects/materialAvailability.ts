/**
 * v10.2.3 (TD-1290، بستهٔ ۳ نسخهٔ ۱۰.۲، یافتهٔ D1 بررسی کنترل پروژه‌ها): موجودی آزاد هر ماده برای همین پروژه با قاعدهٔ خود
 * ثبت نهایی (`planProjectReservation`): موجودی کل منهای رزرو پیش‌فاکتورهای فروش و پروژه‌های ثبت نهایی‌شدهٔ دیگر، و نیاز پروژه
 * منهای آنچه تاکنون به آن داده شده (حواله، ضایعات و تخصیص مواد). پیش‌تر زبانهٔ مواد، فهرست خرید و «سفارش خرید بخش» با موجودی
 * کل می‌سنجیدند و وضعیت ردیف دستی بود: فرم «موجود» می‌گفت و ثبت نهایی کمتر رزرو می‌کرد.
 *
 * ارقام را کارساز می‌دهد (`GET /projects/:id/material-availability`، مقدار، بی بها) و این پرونده، مشترک میان کارساز و مرورگر،
 * وضعیت هر ردیف را از بخش‌های ذخیره‌نشدهٔ فرم می‌سازد، پس وضعیت همان است که ثبت نهایی با همین بخش‌ها می‌دید.
 */

import { fin } from '../financialDecimal.js';
import { findProjectItemMatch } from './projectItemMatch.js';
import { planProjectReservation, rowUnitConvertible, type ReservationShortage } from './projectReservation.js';

/** ارقام موجودی یک کالا برای یک پروژه، به واحد کالا */
export interface MaterialAvailabilityItem {
  itemId: number;
  /** موجودی کل کالا در همهٔ انبارها */
  stock: number;
  /** رزرو پیش‌فاکتورهای فروش و پروژه‌های ثبت نهایی‌شدهٔ دیگر (رزرو خود این پروژه نه) */
  reservedByOthers: number;
  /** آنچه تاکنون به همین پروژه داده شده: حواله و ضایعات قطعی و تخصیص مواد باز یا مصرف‌شده */
  issuedToProject: number;
  /** موجودی کل منهای رزرو دیگران، کمینه صفر */
  freeForProject: number;
}

export interface MaterialAvailabilityReport {
  projectId: number;
  items: MaterialAvailabilityItem[];
}

/** بیشینهٔ شناسه‌های کالا در یک درخواست */
export const MATERIAL_AVAILABILITY_MAX_ITEMS = 500;

export const freeForProject = (stock: unknown, reservedByOthers: unknown): number =>
  Math.max(0, fin(Number(stock) || 0).subtract(Math.max(0, Number(reservedByOthers) || 0)).toNumber());

/** ردیف مادهٔ اولیه در بخش‌های کنترل موجودی (per_item یا global) */
export interface MaterialRowInput {
  itemCode?: string | null;
  name?: string | null;
  unit?: string | null;
  conversionRate?: unknown;
  convertedUnit?: unknown;
}

/** کالای انبار از فهرست انتخاب کالا */
export interface AvailabilityStockItem {
  id: number;
  code?: string | null;
  name?: string | null;
  category?: string | null;
  unit?: string | null;
  current_stock?: number | null;
}

export type MaterialRowState =
  /** ارقام هنوز خوانده نشده یا خواندن آن‌ها ناموفق بوده */
  | { kind: 'unknown' }
  /** ردیف به هیچ کالای انبار نمی‌رسد */
  | { kind: 'unmatched' }
  /** واحد ردیف با واحد کالا فرق دارد و تبدیل معتبر ندارد؛ ثبت نهایی آن را رد می‌کند */
  | { kind: 'unit_mismatch'; itemId: number; free: number; issued: number; unit: string }
  | { kind: 'available'; itemId: number; free: number; issued: number; unit: string }
  /** کسری این کالا در کل پروژه، به واحد کالا */
  | { kind: 'short'; itemId: number; free: number; issued: number; shortQty: number; unit: string };

export type MaterialAvailabilityStatus = 'loading' | 'error' | 'ready';

export interface MaterialAvailabilityView {
  status: MaterialAvailabilityStatus;
  rowState(row: MaterialRowInput): MaterialRowState;
  /** آنچه پروژه برای کالای این ردیف دارد (آزاد + داده‌شده)، به واحد کالا؛ null وقتی ارقام نیست */
  coverOf(row: MaterialRowInput): number | null;
  /** ثبت نهایی اکنون این کالا را کمتر از نیازش رزرو می‌کرد؟ null وقتی ارقام کارساز برای آن نیست */
  isItemShort(itemId: number): boolean | null;
}

const DEFAULT_UNIT = 'عدد';
const textOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

type Row = Record<string, unknown>;
const asRow = (v: unknown): Row | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null);
const asRows = (v: unknown): Row[] => (Array.isArray(v) ? v.map(asRow).filter((r): r is Row => r !== null) : []);

/** همهٔ ردیف‌های مادهٔ بخش‌ها (همهٔ محصولات، الگوی بخش و اقلام عمومی) و اقلام دستی */
function materialRowsOf(sections: unknown, manualPurchaseItems: unknown): MaterialRowInput[] {
  const rows: MaterialRowInput[] = [];
  const push = (r: Row, name: unknown) => rows.push({ itemCode: textOf(r.itemCode), name: textOf(name), unit: textOf(r.unit) });
  for (const sec of asRows(sections)) {
    const perItem = asRow(sec.perItemResults);
    if (perItem) {
      for (const prodRows of Object.values(perItem)) {
        for (const r of Object.values(asRow(prodRows) || {})) {
          const row = asRow(r);
          if (row) push(row, row.name);
        }
      }
    }
    for (const s of asRows(sec.itemsSchema)) push(s, s.name);
    for (const g of asRows(sec.globalItems)) push(g, g.name);
  }
  for (const m of asRows(manualPurchaseItems)) push(m, m.itemName);
  return rows;
}

/** شناسهٔ کالاهای انبار که ردیف‌های پروژه به آن‌ها می‌رسند، به ترتیب و بی تکرار؛ همان شناسه‌هایی که از کارساز خواسته می‌شوند */
export function projectMaterialItemIds(sections: unknown, manualPurchaseItems: unknown, stockItems: readonly AvailabilityStockItem[]): number[] {
  const ids = new Set<number>();
  for (const row of materialRowsOf(sections, manualPurchaseItems)) {
    const match = findProjectItemMatch({ code: row.itemCode, name: row.name }, stockItems);
    if (match && Number.isInteger(match.id) && match.id > 0) ids.add(match.id);
  }
  return [...ids].sort((a, b) => a - b).slice(0, MATERIAL_AVAILABILITY_MAX_ITEMS);
}

/**
 * وضعیت هر ردیف از ارقام کارساز: ثبت نهایی با همین بخش‌ها اجرا می‌شود (موجودی کل، رزرو دیگران و آنچه به پروژه داده شده از
 * کارساز) و کالایی که کمتر از نیازش رزرو می‌شد «کسری» است؛ ردیفی که به کالای انبار نمی‌رسد «بی کالای انبار» و ردیفی با واحد
 * دیگر و بی تبدیل «تبدیل واحد لازم» است. بی ارقام کارساز هیچ ردیفی «موجود» نیست.
 */
export function buildMaterialAvailabilityView(input: {
  sections: unknown;
  products: unknown;
  manualPurchaseItems: unknown;
  stockItems: readonly AvailabilityStockItem[];
  report: MaterialAvailabilityReport | null | undefined;
  status: MaterialAvailabilityStatus;
}): MaterialAvailabilityView {
  const { stockItems, report } = input;
  const ready = input.status === 'ready' && !!report;
  const byId = new Map<number, MaterialAvailabilityItem>();
  for (const it of report?.items ?? []) byId.set(Number(it.itemId), it);

  const shortages = new Map<number, ReservationShortage>();
  if (ready) {
    const planItems = stockItems.map(i => ({
      id: i.id, code: i.code, name: i.name, category: i.category, unit: i.unit,
      currentStock: Number(byId.get(i.id)?.stock ?? i.current_stock) || 0,
    }));
    const reservedByOthers = new Map([...byId.values()].map(a => [a.itemId, a.reservedByOthers]));
    const issuedToProject = new Map([...byId.values()].map(a => [a.itemId, a.issuedToProject]));
    const plan = planProjectReservation(input.sections, input.products, planItems, input.manualPurchaseItems, '', { reservedByOthers, issuedToProject });
    for (const s of plan.shortages) shortages.set(s.itemId, s);
  }

  const rowState = (row: MaterialRowInput): MaterialRowState => {
    const match = findProjectItemMatch({ code: textOf(row.itemCode), name: textOf(row.name) }, stockItems);
    if (!match) return { kind: 'unmatched' };
    const figures = byId.get(match.id);
    if (!ready || !figures) return { kind: 'unknown' };
    const unit = textOf(match.unit) || DEFAULT_UNIT;
    const free = freeForProject(figures.stock, figures.reservedByOthers);
    const issued = Math.max(0, Number(figures.issuedToProject) || 0);
    if (!rowUnitConvertible(row, match.unit)) return { kind: 'unit_mismatch', itemId: match.id, free, issued, unit };
    const short = shortages.get(match.id);
    if (short) return { kind: 'short', itemId: match.id, free, issued, shortQty: short.shortQty, unit };
    return { kind: 'available', itemId: match.id, free, issued, unit };
  };

  return {
    status: input.status,
    rowState,
    coverOf(row) {
      const state = rowState(row);
      return state.kind === 'available' || state.kind === 'short' || state.kind === 'unit_mismatch'
        ? fin(state.free).add(state.issued).toNumber()
        : null;
    },
    isItemShort(itemId) {
      return ready && byId.has(itemId) ? shortages.has(itemId) : null;
    },
  };
}

/**
 * v10.2.3 (TD-1290): کالاهایی که ثبت نهایی ذخیره‌شده کمتر از نیازشان رزرو کرد و اکنون موجودی آزاد نیاز را می‌پوشاند. رزرو
 * ذخیره‌شده با رسیدن موجودی خودبه‌خود بزرگ نمی‌شود و پیش‌فاکتور فروش هنوز می‌تواند آن موجودی را ببرد؛ از TD-1341 «تکمیل رزرو»
 * آن را بی لغو ثبت نهایی رزرو می‌کند.
 */
export function storedShortagesNowFree<T extends { itemId: number }>(view: MaterialAvailabilityView, isFinalized: boolean, storedShortages: readonly T[] | null | undefined): T[] {
  if (!isFinalized || view.status !== 'ready') return [];
  return (storedShortages ?? []).filter(s => view.isItemShort(Number(s.itemId)) === false);
}

/** ردیفی که خرید یا بررسی می‌خواهد (کسری، بی کالای انبار یا تبدیل واحد لازم) */
export const rowNeedsAttention = (state: MaterialRowState): boolean =>
  state.kind === 'short' || state.kind === 'unmatched' || state.kind === 'unit_mismatch';

/** ارقام آزاد و داده‌شدهٔ ردیف، یا null وقتی ارقام کارساز برای آن نیست */
export const materialFiguresOf = (state: MaterialRowState): { free: number; issued: number } | null =>
  state.kind === 'available' || state.kind === 'short' || state.kind === 'unit_mismatch' ? { free: state.free, issued: state.issued } : null;

/**
 * ردیف در فهرست خرید و شمار کسری می‌آید؟ با ارقام کارساز از وضعیت ردیف (کسری، یا بی کالای انبار)؛ بی آن‌ها (در حال خواندن یا
 * خطا) قاعدهٔ پیشین صفحه، `legacyShort` (کسری نسبت به موجودی کل یا وضعیت ذخیره‌شده)، تا ردیفی از فهرست خرید نیفتد. ردیفی که
 * تبدیل واحد لازم دارد هم با قاعدهٔ پیشین سنجیده می‌شود: نیاز آن به واحد کالا معلوم نیست و تبدیل واحد خرید نمی‌خواهد.
 */
export const rowIsShort = (state: MaterialRowState, legacyShort: boolean): boolean =>
  state.kind === 'unknown' || state.kind === 'unit_mismatch' ? legacyShort : state.kind === 'short' || state.kind === 'unmatched';

/** پاسخ `GET /projects/:id/material-availability`، یا null وقتی شکل آن نامعتبر است */
export function materialAvailabilityReportOf(raw: unknown): MaterialAvailabilityReport | null {
  const body = asRow(raw);
  if (!body || !Array.isArray(body.items)) return null;
  const items: MaterialAvailabilityItem[] = [];
  for (const r of asRows(body.items)) {
    const itemId = Number(r.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) return null;
    items.push({
      itemId,
      stock: Number(r.stock) || 0,
      reservedByOthers: Number(r.reservedByOthers) || 0,
      issuedToProject: Number(r.issuedToProject) || 0,
      freeForProject: Number(r.freeForProject) || 0,
    });
  }
  return { projectId: Number(body.projectId) || 0, items };
}
