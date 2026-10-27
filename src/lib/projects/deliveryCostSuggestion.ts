/**
 * v10.2.3 (TD-1290، بستهٔ ۳ نسخهٔ ۱۰.۲، یافتهٔ D2): گزارش بهای «ورود به انبار» پروژه (`GET /projects/:id/delivery-cost`) و نمای
 * ماندهٔ «کالای در جریان ساخت» (۱۴۰۲) پروژه پیش و پس از یک ورود، مشترک میان زبانهٔ «ورود به انبار» و آزمون‌ها.
 *
 * v11 phase 6.1ث (S2, decision ت۵۲-۳): the receipt's cost is the project's real cost, priced by the server with the rule
 * of `planDeliveryCost` (`./deliveryCostPlan.ts`); the tab runs the same rule on this report to show each line's unit cost,
 * what the receipt takes from 1402 and whether it will ask for a reason. Before, the tab suggested a cost and the server
 * posted whatever was sent.
 */

import { fin } from '../financialDecimal.js';
import { deliveryLinesValue, planDeliveryCost, postedDeliveryCosts, type DeliveryCostReasonKind, type DeliveryCostRule } from './deliveryCostPlan.js';

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


export interface DeliveryOutlookLine {
  itemId: number;
  quantity: number;
  /** the cost the user typed; null or zero is none */
  typedUnitCost: number | null;
}

export interface DeliveryCostOutlook {
  rule: DeliveryCostRule;
  multiProduct: boolean;
  /** with this receipt every product of the plan is delivered */
  completesPlan: boolean;
  /** why the server will ask for a reason, or null */
  reasonNeeded: DeliveryCostReasonKind | null;
  wipBalance: number;
  /** what this receipt takes from the project's 1402 */
  credit: number;
  /** the project's 1402 after this receipt */
  remaining: number;
  /** the unit cost the receipt computes for each line, the line order kept */
  unitCosts: number[];
  /** lines that would enter without any cost (none typed and no weighted average cost) */
  withoutCost: number;
  /** with the reason, what goes to «اختلاف بهای تولید»: the lines at their typed costs less `credit` */
  variance: number;
}

/** the 1402 outlook of a receipt with these lines; null without the cost figures */
export function deliveryCostOutlook(report: DeliveryCostReport | null | undefined, lines: readonly DeliveryOutlookLine[]): DeliveryCostOutlook | null {
  if (!report || !report.costVisible || report.wipBalance === null) return null;
  const byId = new Map(report.products.map(p => [p.itemId, p]));
  const planLines = lines.map(l => ({
    itemId: l.itemId, quantity: Number(l.quantity) > 0 ? l.quantity : 0, typedUnitCost: l.typedUnitCost, weightedAverageCost: byId.get(l.itemId)?.weightedAverageCost ?? 0,
  }));
  const plan = planDeliveryCost(report.wipBalance, report.products.map(p => ({ itemId: p.itemId, plannedQty: p.plannedQty, deliveredQty: p.deliveredQty })), planLines);
  const posted = postedDeliveryCosts(plan, planLines, true);
  return {
    rule: plan.rule,
    multiProduct: plan.multiProduct,
    completesPlan: plan.completesPlan,
    reasonNeeded: plan.reasonNeeded,
    wipBalance: fin(plan.wipBalance).toNumber(),
    credit: fin(plan.wipCredit).toNumber(),
    remaining: fin(plan.wipBalance).subtract(plan.wipCredit).toNumber(),
    unitCosts: plan.unitCosts.map(c => fin(c).toNumber()),
    withoutCost: planLines.filter((l, i) => Number(l.quantity) > 0 && !fin(posted[i]).isPositive()).length,
    variance: fin(deliveryLinesValue(planLines, posted)).subtract(plan.wipCredit).toNumber(),
  };
}
