/**
 * v10.2.2 (TD-1290، بستهٔ ۳ نسخهٔ ۱۰.۲، یافتهٔ D2): بهای واحد پیشنهادی رسید تولید پروژه و مانده‌ای که پس از آن در «کالای در
 * جریان ساخت» (۱۴۰۲) پروژه می‌ماند، مشترک میان کارساز و زبانهٔ «ورود به انبار».
 *
 * رسید تولید پروژه ۱۴۰۲ همان پروژه را به مقدار × بهای واحد بستانکار می‌کند؛ بهای واردنشده میانگین موزون بهای جاری محصول است
 * (قاعدهٔ سرور بی‌تغییر). پیش‌تر کاربر عدد را دستی می‌نوشت و اگر با مواد پروژه نمی‌خواند، مانده‌ای در ۱۴۰۲ پروژه می‌ماند. اکنون
 * برای پروژهٔ تک‌محصولی بهای واحد = ماندهٔ ۱۴۰۲ پروژه ÷ مقدار باقی‌ماندهٔ برنامه (یا مقدار همین تحویل اگر بیشتر است) پیشنهاد
 * می‌شود، به چهار رقم اعشار مانند ستون بها؛ کاربر می‌تواند عوضش کند. ماندهٔ ۱۴۰۲ همهٔ سندهای پروژه است، پیش‌نویس هم
 * (`projectWipBalances`): تخصیص مواد و حوالهٔ پروژه منهای تحویل‌های قبلی. دستمزد مانند قبل در آن نمی‌آید.
 * پروژهٔ چندمحصولی پیشنهاد خودکار ندارد؛ مانده و هشدار نشان داده می‌شود.
 */

import { fin } from '../financialDecimal.js';

export interface DeliveryCostProduct {
  itemId: number;
  /** مقدار برنامهٔ پروژه برای این محصول */
  plannedQty: number;
  /** جمع ردیف‌های رسید تولید قطعی و زندهٔ پروژه برای این محصول */
  deliveredQty: number;
  /** میانگین موزون بهای جاری محصول به ریال؛ برای خوانندهٔ بی مجوز بها null */
  weightedAverageCost: number | null;
}

export interface DeliveryCostReport {
  projectId: number;
  /** خواننده مجوز دیدن بها دارد؛ بی آن مانده و بها null است */
  costVisible: boolean;
  /** ماندهٔ بدهکار ۱۴۰۲ پروژه به ریال، همهٔ وضعیت‌های سند؛ صفر وقتی مانده‌ای نیست */
  wipBalance: number | null;
  products: DeliveryCostProduct[];
}

/** رقم اعشار بهای واحد، همان مقیاس ستون `unit_price` */
export const DELIVERY_UNIT_COST_SCALE = 4;

/**
 * بهای واحد پیشنهادی یک محصول: ماندهٔ ۱۴۰۲ ÷ بیشینهٔ (مقدار باقی‌ماندهٔ برنامه، مقدار این تحویل)؛ بی ماندهٔ مثبت یا بی مقدار، null.
 * با مقدار باقی‌مانده، تحویل آخر برنامه ماندهٔ ۱۴۰۲ را می‌بندد و تحویل بیش از برنامه همهٔ مانده را می‌برد.
 */
export function suggestedDeliveryUnitCost(wipBalance: unknown, plannedQty: unknown, deliveredQty: unknown, deliveryQty: unknown): number | null {
  const wip = fin(Number(wipBalance) || 0);
  if (!wip.isPositive()) return null;
  const remaining = Math.max(0, fin(Number(plannedQty) || 0).subtract(Number(deliveredQty) || 0).toNumber());
  const divisor = Math.max(remaining, Number(deliveryQty) > 0 ? Number(deliveryQty) : 0);
  if (!(divisor > 0)) return null;
  return wip.divide(divisor, DELIVERY_UNIT_COST_SCALE).toNumber();
}

export interface DeliveryLineCost {
  quantity: unknown;
  /** بهای واردشده یا پیشنهادی؛ صفر یا خالی یعنی میانگین موزون بهای جاری */
  unitPrice: unknown;
  weightedAverageCost: unknown;
}

/** آنچه این تحویل از ۱۴۰۲ پروژه برمی‌دارد: Σ مقدار × (بهای واحد، وگرنه میانگین موزون بها)، به ریال */
export function deliveryWipCredit(lines: readonly DeliveryLineCost[]): { credit: number; withoutCost: number } {
  let credit = fin(0);
  let withoutCost = 0;
  for (const line of lines) {
    const qty = Number(line.quantity) || 0;
    if (!(qty > 0)) continue;
    const entered = Number(line.unitPrice) || 0;
    const price = entered > 0 ? entered : Number(line.weightedAverageCost) || 0;
    if (!(price > 0)) {
      withoutCost += 1;
      continue;
    }
    credit = credit.add(fin(qty).multiply(price));
  }
  return { credit: credit.round(DELIVERY_UNIT_COST_SCALE).toNumber(), withoutCost };
}

/** ماندهٔ ۱۴۰۲ پروژه پس از این تحویل؛ منفی یعنی بیش از مواد پروژه بستانکار می‌شود */
export const wipAfterDelivery = (wipBalance: unknown, credit: unknown): number =>
  fin(Number(wipBalance) || 0).subtract(Number(credit) || 0).round(DELIVERY_UNIT_COST_SCALE).toNumber();

const numberOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** پاسخ `GET /projects/:id/delivery-cost`، یا null وقتی شکل آن نامعتبر است */
export function deliveryCostReportOf(raw: unknown): DeliveryCostReport | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.products) || typeof body.costVisible !== 'boolean') return null;
  const products: DeliveryCostProduct[] = [];
  for (const p of body.products as unknown[]) {
    if (!p || typeof p !== 'object') return null;
    const r = p as Record<string, unknown>;
    const itemId = Number(r.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) return null;
    products.push({
      itemId,
      plannedQty: Number(r.plannedQty) || 0,
      deliveredQty: Number(r.deliveredQty) || 0,
      weightedAverageCost: body.costVisible ? numberOrNull(r.weightedAverageCost) : null,
    });
  }
  return {
    projectId: Number(body.projectId) || 0,
    costVisible: body.costVisible,
    wipBalance: body.costVisible ? numberOrNull(body.wipBalance) : null,
    products,
  };
}

/**
 * بهای واحد پیشنهادی یک ردیف «ورود به انبار»: فقط برای پروژهٔ تک‌محصولی، خوانندهٔ مجاز به دیدن بها و همان محصول برنامه؛
 * وگرنه null و ردیف مانند پیش خالی می‌ماند (میانگین موزون بها).
 */
export function projectDeliverySuggestion(report: DeliveryCostReport | null | undefined, itemId: unknown, deliveryQty: unknown): number | null {
  if (!report || !report.costVisible || report.products.length !== 1) return null;
  const [product] = report.products;
  if (product.itemId !== Number(itemId)) return null;
  return suggestedDeliveryUnitCost(report.wipBalance, product.plannedQty, product.deliveredQty, deliveryQty);
}

export interface DeliveryOutlookLine {
  itemId: number;
  quantity: number;
  /** بهای واردشده یا پیشنهادی؛ null یا صفر یعنی میانگین موزون بهای جاری */
  unitPrice: number | null;
}

export interface DeliveryCostOutlook {
  wipBalance: number;
  /** آنچه این تحویل از ۱۴۰۲ پروژه برمی‌دارد */
  credit: number;
  /** ماندهٔ ۱۴۰۲ پس از این تحویل */
  remaining: number;
  /** ردیف‌هایی که نه بها دارند نه میانگین موزون بها (کارساز نمی‌پذیرد) */
  withoutCost: number;
  /** با این تحویل همهٔ برنامهٔ پروژه تحویل شده است */
  completesPlan: boolean;
  multiProduct: boolean;
}

/** نمای ماندهٔ ۱۴۰۲ پیش و پس از این تحویل؛ بی مجوز بها null */
export function deliveryCostOutlook(report: DeliveryCostReport | null | undefined, lines: readonly DeliveryOutlookLine[]): DeliveryCostOutlook | null {
  if (!report || !report.costVisible || report.wipBalance === null) return null;
  const byId = new Map(report.products.map(p => [p.itemId, p]));
  const { credit, withoutCost } = deliveryWipCredit(lines.map(l => ({
    quantity: l.quantity, unitPrice: l.unitPrice, weightedAverageCost: byId.get(l.itemId)?.weightedAverageCost ?? 0,
  })));
  const delivering = new Map<number, number>();
  for (const l of lines) {
    if (Number(l.quantity) > 0) delivering.set(l.itemId, fin(delivering.get(l.itemId) ?? 0).add(l.quantity).toNumber());
  }
  const completesPlan = report.products.length > 0
    && report.products.every(p => fin(p.deliveredQty).add(delivering.get(p.itemId) ?? 0).toNumber() >= p.plannedQty);
  return {
    wipBalance: report.wipBalance,
    credit,
    remaining: wipAfterDelivery(report.wipBalance, credit),
    withoutCost,
    completesPlan,
    multiProduct: report.products.length > 1,
  };
}

export interface DeliveryPriceLine {
  itemId: number;
  quantity: number;
  /** بهای واردشدهٔ کاربر؛ undefined یعنی خانه دست نخورده و پیشنهاد به کار می‌رود، صفر یعنی پاک‌شده (میانگین موزون بها) */
  typedPrice: number | undefined;
  /** پیشنهادی که خانه نشان می‌داد */
  shownSuggestion: number | null;
}

export type DeliveryPriceCheck =
  /** ماندهٔ ۱۴۰۲ از زمان خواندن صفحه عوض شده و پیشنهاد خانه‌ای دست‌نخورده دیگر همان نیست؛ چیزی فرستاده نمی‌شود */
  | { kind: 'suggestion_changed' }
  /** بهای هر ردیف (undefined = میانگین موزون بها) و ماندهٔ ۱۴۰۲ پس از این ورود؛ `overdraws` یعنی مانده منفی می‌شود */
  | { kind: 'post'; prices: Array<number | undefined>; outlook: DeliveryCostOutlook | null; overdraws: boolean };

/**
 * v10.2.2 (TD-1290، بررسی بستهٔ ۳): بهای ردیف‌های یک ورود به انبار با گزارش تازهٔ ۱۴۰۲ درست پیش از فرستادن. پیشنهاد کهنه (کاربر
 * دیگری در این میان تحویل داده، یا کادر دلیل بیش از برنامه بدنهٔ پیشین را دوباره می‌فرستد) فرستاده نمی‌شود، و وقتی این ورود
 * بیش از ماندهٔ ۱۴۰۲ پروژه بستانکار می‌کند `overdraws` هشدار پیش از ثبت را می‌خواهد. قاعدهٔ ثبت کارساز همان است که بود.
 */
export function checkDeliveryPrices(fresh: DeliveryCostReport, lines: readonly DeliveryPriceLine[], singleProduct: boolean): DeliveryPriceCheck {
  const prices: Array<number | undefined> = [];
  for (const line of lines) {
    const suggestion = singleProduct ? projectDeliverySuggestion(fresh, line.itemId, line.quantity) : null;
    if (line.typedPrice === undefined && suggestion !== line.shownSuggestion) return { kind: 'suggestion_changed' };
    const price = line.typedPrice !== undefined ? line.typedPrice : suggestion;
    prices.push(price && price > 0 ? Number(price) : undefined);
  }
  const outlook = deliveryCostOutlook(fresh, lines.map((l, i) => ({ itemId: l.itemId, quantity: l.quantity, unitPrice: prices[i] ?? null })));
  return { kind: 'post', prices, outlook, overdraws: !!outlook && outlook.credit > 0 && outlook.remaining < 0 };
}
