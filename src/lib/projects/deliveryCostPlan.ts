/**
 * v11 phase 6.1ث (S2, decision ت۵۲-۳): the cost of a project's production receipt is the project's real cost, the work in
 * progress (1402) that the project's materials gathered. One rule for the server, which prices the receipt under the project
 * lock, and for the delivery tab, which shows the same figures before the send.
 *
 * - One product: the receipt takes WIP × its quantity ÷ the plan's remaining quantity (its own quantity when that is more),
 *   so each unit costs the same; the receipt that completes the plan takes all of WIP.
 * - Several products (decision ت۵۹ A): quantities of different products do not add up, so before the plan is complete each
 *   line costs its typed cost, else the product's weighted average cost, and the receipt takes that from WIP. The receipt
 *   that completes the plan takes all of WIP, spread over its lines by those costs (by quantity when none has a cost).
 * - No WIP: there is nothing to take; the lines keep their typed or weighted average cost.
 *
 * A cost other than the project's real cost needs a reason (`reasonNeeded`): a typed cost of a single-product receipt that
 * differs from the computed one, a several-product receipt that takes more than WIP, and any receipt of a project without
 * WIP. With the reason the typed costs stand, the receipt still takes its computed share of WIP, and the voucher posts the
 * difference to «اختلاف بهای تولید».
 */

import { fin, type DecimalValue, type FinancialDecimal } from '../financialDecimal.js';

/** decimals of a unit cost, the scale of `unit_price` */
export const DELIVERY_COST_SCALE = 4;

export type DeliveryCostRule =
  /** one product, part of the plan: a share of WIP by quantity */
  | 'share'
  /** the receipt completes the plan and takes all of WIP */
  | 'complete'
  /** several products before the plan is complete: the typed or weighted average costs */
  | 'entered'
  /** the project has no WIP to take */
  | 'no_wip';

export type DeliveryCostReasonKind =
  /** a typed cost of a single-product receipt differs from the computed one */
  | 'cost_changed'
  /** a several-product receipt takes more than WIP */
  | 'overdraw'
  /** the project has no WIP */
  | 'no_wip';

export interface DeliveryPlanProduct {
  itemId: number;
  /** the plan's quantity of this product */
  plannedQty: DecimalValue;
  /** the quantity live final production receipts of the project already delivered */
  deliveredQty: DecimalValue;
}

export interface DeliveryPlanLine {
  itemId: number;
  quantity: DecimalValue;
  /** the cost the user typed; empty, zero or null is none */
  typedUnitCost: DecimalValue;
  /** the product's weighted average cost now */
  weightedAverageCost: DecimalValue;
}

export interface DeliveryCostPlan {
  rule: DeliveryCostRule;
  multiProduct: boolean;
  /** with this receipt every product of the plan is delivered */
  completesPlan: boolean;
  /** the project's WIP before the receipt, in rials */
  wipBalance: string;
  /** what the receipt takes from WIP, never negative */
  wipCredit: string;
  /** the computed unit cost of each line, the line order kept */
  unitCosts: string[];
  /** the lines whose typed cost differs from the computed one (a single-product receipt) */
  changedLines: number[];
  /** why the receipt needs a reason, or null */
  reasonNeeded: DeliveryCostReasonKind | null;
}

const positiveOrNull = (value: DecimalValue): FinancialDecimal | null => {
  if (value === null || value === undefined || value === '') return null;
  const decimal = fin(value);
  return decimal.isPositive() ? decimal : null;
};

const nonNegative = (value: DecimalValue): FinancialDecimal => positiveOrNull(value) ?? fin(0);

const sum = (values: FinancialDecimal[]): FinancialDecimal => values.reduce((total, v) => total.add(v), fin(0));

/** the typed cost of a line, else its product's weighted average cost */
const baseCostOf = (line: DeliveryPlanLine): FinancialDecimal =>
  (positiveOrNull(line.typedUnitCost) ?? nonNegative(line.weightedAverageCost)).round(DELIVERY_COST_SCALE);

/** the cost of a production receipt under the project's WIP, its plan and its earlier deliveries */
export function planDeliveryCost(wipBalance: DecimalValue, products: readonly DeliveryPlanProduct[], lines: readonly DeliveryPlanLine[]): DeliveryCostPlan {
  const wip = fin(wipBalance ?? 0).round(DELIVERY_COST_SCALE);
  const quantities = lines.map(line => nonNegative(line.quantity));
  const delivering = new Map<number, FinancialDecimal>();
  lines.forEach((line, i) => delivering.set(line.itemId, (delivering.get(line.itemId) ?? fin(0)).add(quantities[i])));
  const completesPlan = products.length > 0
    && products.every(p => nonNegative(p.deliveredQty).add(delivering.get(p.itemId) ?? fin(0)).greaterThanOrEqual(nonNegative(p.plannedQty)));
  const multiProduct = products.length !== 1;
  const base = lines.map(baseCostOf);
  const plan = (rule: DeliveryCostRule, wipCredit: FinancialDecimal, unitCosts: FinancialDecimal[], reasonNeeded: DeliveryCostReasonKind | null, changedLines: number[] = []): DeliveryCostPlan => ({
    rule, multiProduct, completesPlan, wipBalance: wip.toString(), wipCredit: wipCredit.round(DELIVERY_COST_SCALE).toString(),
    unitCosts: unitCosts.map(c => c.toString()), changedLines, reasonNeeded,
  });

  if (!wip.isPositive()) return plan('no_wip', fin(0), base, 'no_wip');

  if (!multiProduct) {
    const [product] = products;
    const remaining = nonNegative(fin(product.plannedQty ?? 0).subtract(nonNegative(product.deliveredQty)));
    const totalQty = sum(quantities);
    const divisor = remaining.greaterThan(totalQty) ? remaining : totalQty;
    const unit = divisor.isPositive() ? wip.divide(divisor, DELIVERY_COST_SCALE) : fin(0);
    const unitCosts = lines.map(() => unit);
    const changedLines = lines.flatMap((line, i) => {
      const typed = positiveOrNull(line.typedUnitCost);
      return typed && !typed.round(DELIVERY_COST_SCALE).equals(unit) ? [i] : [];
    });
    const reason = changedLines.length > 0 ? 'cost_changed' : null;
    if (completesPlan) return plan('complete', wip, unitCosts, reason, changedLines);
    return plan('share', sum(quantities.map(q => q.multiply(unit))), unitCosts, reason, changedLines);
  }

  if (completesPlan) {
    const valued = quantities.map((q, i) => q.multiply(base[i]));
    const weights = sum(valued).isPositive() ? valued : quantities;
    const totalWeight = sum(weights);
    const unitCosts = lines.map((_, i) => (quantities[i].isPositive() && totalWeight.isPositive()
      ? wip.multiply(weights[i]).divide(totalWeight.multiply(quantities[i]), DELIVERY_COST_SCALE)
      : fin(0)));
    return plan('complete', wip, unitCosts, null);
  }

  const total = sum(quantities.map((q, i) => q.multiply(base[i]))).round(DELIVERY_COST_SCALE);
  const overdraws = total.subtract(wip).round(0).isPositive();
  return plan('entered', total.greaterThan(wip) ? wip : total, base, overdraws ? 'overdraw' : null);
}

/**
 * The unit cost each line is recorded at: the computed one, or, when the receipt needed a reason and has it, the typed one
 * where a cost was typed.
 */
export function postedDeliveryCosts(plan: DeliveryCostPlan, lines: readonly DeliveryPlanLine[], withReason: boolean): string[] {
  return plan.unitCosts.map((computed, i) => {
    const typed = withReason && plan.reasonNeeded ? positiveOrNull(lines[i]?.typedUnitCost) : null;
    return typed ? typed.round(DELIVERY_COST_SCALE).toString() : computed;
  });
}

/** Σ quantity × unit cost of the lines, in rials */
export function deliveryLinesValue(lines: readonly Pick<DeliveryPlanLine, 'quantity'>[], unitCosts: readonly DecimalValue[]): string {
  return sum(lines.map((line, i) => nonNegative(line.quantity).multiply(fin(unitCosts[i] ?? 0)))).round(DELIVERY_COST_SCALE).toString();
}
