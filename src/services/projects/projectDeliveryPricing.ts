import { inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { items, productionReceiptCosts } from '../../db/schema.js';
import { AppError } from '../../errors/customErrors.js';
import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { deliveryLinesValue, planDeliveryCost, postedDeliveryCosts, type DeliveryCostPlan, type DeliveryPlanLine } from '../../lib/projects/deliveryCostPlan.js';
import { formatPersianNumber } from '../../utils/persianNumber.js';
import { projectWipBalances } from '../accounting/projectWipBalance.js';

export interface DeliveryLineInput {
  itemId: number;
  quantity: number;
  /** the cost the user typed, or null */
  typedUnitCost: string | null;
  location: string;
}

export interface PricedDelivery {
  lines: Array<{ itemId: number; quantity: number; unitPrice: string; location: string }>;
  plan: DeliveryCostPlan;
  /** the reason kept with the receipt: only when its cost needed one */
  reason: string;
}

const COST_REASON_MESSAGES = {
  no_wip: (project: string) =>
    `کالای در جریان ساخت پروژه «${project}» مانده‌ای ندارد (موادی به پروژه تخصیص یا حواله نشده، یا همه با تحویل‌های پیشین رفته است)، ` +
    'پس بهای واقعی این تولید صفر است. برای ورود به بهای واردشده یا میانگین موزون بها دلیل را بنویسید؛ این مبلغ به حساب «اختلاف بهای تولید» می‌رود.',
  cost_changed: (project: string) =>
    `بهای واحد واردشده با بهای واقعی تولید پروژه «${project}» (ماندهٔ کالای در جریان ساخت تقسیم بر مقدار باقی‌ماندهٔ برنامه) نمی‌خواند. ` +
    'بها را خالی بگذارید تا بهای واقعی ثبت شود، یا دلیل را بنویسید؛ اختلاف به حساب «اختلاف بهای تولید» می‌رود.',
  overdraw: (project: string) =>
    `جمع بهای این ورود بیش از ماندهٔ کالای در جریان ساخت پروژه «${project}» است. ` +
    'بهای ردیف‌ها را کم کنید، یا دلیل را بنویسید؛ بیش از مانده به حساب «اختلاف بهای تولید» می‌رود.',
} as const;

const amount = (value: string, decimals: number) => formatPersianNumber(fin(value).toNumber(), decimals);

/**
 * v11 phase 6.1ث (S2, decision ت۵۲-۳): the unit cost of each line of a project delivery, priced inside the delivery
 * transaction after the project lock, so the project's 1402 (`projectWipBalances`, every voucher status) and its earlier
 * deliveries cannot change underneath. The rule is `planDeliveryCost`; a cost other than the project's real cost without
 * `reason` is 422 `PRODUCTION_COST_REASON_REQUIRED` with the figures (a delivery takes `warehouse.in`, an item cost key),
 * and with it the typed costs stand. The items are locked by the caller.
 */
export async function priceProjectDelivery(tx: DbExecutor, input: {
  projectId: number;
  projectLabel: string;
  planned: Map<number, { quantity: FinancialDecimal }>;
  delivered: Map<number, FinancialDecimal>;
  lines: DeliveryLineInput[];
  reason: string;
}): Promise<PricedDelivery> {
  const wip = (await projectWipBalances(tx, [input.projectId])).get(input.projectId) ?? '0';
  const itemIds = [...new Set(input.lines.map(l => l.itemId))];
  const costRows = itemIds.length > 0
    ? await tx.select({ id: items.id, wac: items.weightedAverageCost }).from(items).where(inArray(items.id, itemIds))
    : [];
  const wacOf = new Map(costRows.map(r => [r.id, fin(r.wac ?? 0).toString()]));
  const planLines: DeliveryPlanLine[] = input.lines.map(l => ({
    itemId: l.itemId, quantity: l.quantity, typedUnitCost: l.typedUnitCost, weightedAverageCost: wacOf.get(l.itemId) ?? '0',
  }));
  const products = [...input.planned].map(([itemId, plan]) => ({ itemId, plannedQty: plan.quantity, deliveredQty: input.delivered.get(itemId) ?? fin(0) }));
  const plan = planDeliveryCost(wip, products, planLines);

  if (plan.reasonNeeded && !input.reason) {
    const figures = {
      no_wip: ` (ماندهٔ کالای در جریان ساخت: ${amount(plan.wipBalance, 0)} ریال)`,
      cost_changed: ` (بهای واقعی هر واحد: ${amount(plan.unitCosts[0] ?? '0', 4)} ریال)`,
      overdraw: ` (ماندهٔ کالای در جریان ساخت ${amount(plan.wipBalance, 0)} ریال، جمع این ورود ${amount(deliveryLinesValue(planLines, plan.unitCosts), 0)} ریال)`,
    }[plan.reasonNeeded];
    throw new AppError(
      `${COST_REASON_MESSAGES[plan.reasonNeeded](input.projectLabel)}${figures}`,
      422,
      'PRODUCTION_COST_REASON_REQUIRED',
      {
        kind: plan.reasonNeeded,
        rule: plan.rule,
        changedLines: plan.changedLines,
        wipBalance: plan.wipBalance,
        wipCredit: plan.wipCredit,
        unitCosts: plan.unitCosts,
      },
    );
  }

  const reason = plan.reasonNeeded ? input.reason : '';
  const posted = postedDeliveryCosts(plan, planLines, Boolean(reason));
  return {
    lines: input.lines.map((l, i) => ({ itemId: l.itemId, quantity: l.quantity, unitPrice: posted[i], location: l.location })),
    plan,
    reason,
  };
}

/** the pricing of a delivery's production receipt, written in the delivery transaction before its voucher is built */
export async function recordProductionReceiptCost(tx: DbExecutor, documentId: number, projectId: number, priced: PricedDelivery): Promise<void> {
  await tx.insert(productionReceiptCosts).values({
    documentId,
    projectId,
    wipBalance: priced.plan.wipBalance,
    wipCredit: priced.plan.wipCredit,
    costRule: priced.plan.rule,
    reason: priced.reason,
  });
}
