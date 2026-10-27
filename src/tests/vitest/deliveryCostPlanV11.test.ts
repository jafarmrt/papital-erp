import { describe, expect, it } from 'vitest';
import { deliveryLinesValue, planDeliveryCost, postedDeliveryCosts } from '../../lib/projects/deliveryCostPlan';
import { deliveryCostOutlook, type DeliveryCostReport } from '../../lib/projects/deliveryCostSuggestion';

// v11 phase 6.1ث (S2, decision ت۵۲-۳): a project's production receipt costs the project's real cost (its 1402), one rule
// for the server and the «ورود به انبار» tab; a different cost needs a reason and the difference goes to «اختلاف بهای تولید».

const CHAIR = 11;
const TABLE = 12;
const line = (itemId: number, quantity: number, typedUnitCost: number | null = null, weightedAverageCost = 0) => ({ itemId, quantity, typedUnitCost, weightedAverageCost });

describe('one product: a share of 1402 by quantity, the last receipt closes it', () => {
  const product = (deliveredQty: number) => [{ itemId: CHAIR, plannedQty: 10, deliveredQty }];

  it('takes 1402 × quantity ÷ the remaining plan before the plan is complete', () => {
    const plan = planDeliveryCost(1000, product(0), [line(CHAIR, 4, null, 70)]);
    expect(plan.rule).toBe('share');
    expect(plan.unitCosts).toEqual(['100']);
    expect(plan.wipCredit).toBe('400');
    expect(plan.reasonNeeded).toBeNull();
  });

  it('takes all of 1402 with the receipt that completes the plan, at four decimals per unit', () => {
    const plan = planDeliveryCost(1000, product(7), [line(CHAIR, 3)]);
    expect(plan.rule).toBe('complete');
    expect(plan.completesPlan).toBe(true);
    expect(plan.unitCosts).toEqual(['333.3333']);
    expect(plan.wipCredit).toBe('1000');
    expect(deliveryLinesValue([line(CHAIR, 3)], plan.unitCosts)).toBe('999.9999');
  });

  it('divides by the delivered quantity when it is more than the remaining plan', () => {
    const plan = planDeliveryCost(50, product(10), [line(CHAIR, 2)]);
    expect(plan.unitCosts).toEqual(['25']);
    expect(plan.wipCredit).toBe('50');
  });

  it('asks a reason for a typed cost other than the computed one, and keeps the typed cost only with it', () => {
    const lines = [line(CHAIR, 4, 120)];
    const plan = planDeliveryCost(1000, product(0), lines);
    expect(plan.reasonNeeded).toBe('cost_changed');
    expect(plan.changedLines).toEqual([0]);
    expect(plan.wipCredit).toBe('400');
    expect(postedDeliveryCosts(plan, lines, false)).toEqual(['100']);
    expect(postedDeliveryCosts(plan, lines, true)).toEqual(['120']);
    expect(planDeliveryCost(1000, product(0), [line(CHAIR, 4, 100.00001)]).reasonNeeded).toBeNull();
  });
});

describe('several products (decision t59 A)', () => {
  const products = (chairsDelivered: number) => [
    { itemId: CHAIR, plannedQty: 10, deliveredQty: chairsDelivered },
    { itemId: TABLE, plannedQty: 1, deliveredQty: 0 },
  ];

  it('prices each line at its typed or weighted average cost before the plan is complete', () => {
    const plan = planDeliveryCost(5000, products(0), [line(CHAIR, 5, null, 100)]);
    expect(plan.rule).toBe('entered');
    expect(plan.unitCosts).toEqual(['100']);
    expect(plan.wipCredit).toBe('500');
    expect(plan.reasonNeeded).toBeNull();
  });

  it('asks a reason when the lines take more than 1402, and then takes 1402 only', () => {
    const lines = [line(CHAIR, 5, 2000, 100)];
    const plan = planDeliveryCost(5000, products(0), lines);
    expect(plan.reasonNeeded).toBe('overdraw');
    expect(plan.wipCredit).toBe('5000');
    expect(postedDeliveryCosts(plan, lines, true)).toEqual(['2000']);
  });

  // TD-1326: the overdraw is judged in rials, half away from zero like the voucher
  it('counts half a rial above 1402 as an overdraw and less than that as none', () => {
    expect(planDeliveryCost(1000, products(0), [line(CHAIR, 1, 1000.5)]).reasonNeeded).toBe('overdraw');
    expect(planDeliveryCost(1000, products(0), [line(CHAIR, 1, 1000.4999)]).reasonNeeded).toBeNull();
  });

  it('spreads all of 1402 over the completing receipt by its costs', () => {
    const plan = planDeliveryCost(4500, products(5), [line(CHAIR, 5, null, 100), line(TABLE, 1, 1500)]);
    expect(plan.rule).toBe('complete');
    expect(plan.unitCosts).toEqual(['225', '3375']);
    expect(plan.wipCredit).toBe('4500');
    expect(plan.reasonNeeded).toBeNull();
  });

  it('spreads it by quantity when no line has a cost', () => {
    const plan = planDeliveryCost(600, products(5), [line(CHAIR, 5), line(TABLE, 1)]);
    expect(plan.unitCosts).toEqual(['100', '100']);
  });

  // review of S2: a new product without any cost no longer enters at zero and is refused
  it('spreads it by quantity when one line has no cost of its own', () => {
    const plan = planDeliveryCost(5500, products(0), [line(CHAIR, 10, null, 100), line(TABLE, 1)]);
    expect(plan.rule).toBe('complete');
    expect(plan.unitCosts).toEqual(['500', '500']);
    expect(plan.wipCredit).toBe('5500');
    expect(plan.reasonNeeded).toBeNull();
  });
});

describe('a project without 1402', () => {
  it('takes nothing, keeps the typed or average cost and asks a reason', () => {
    for (const wip of [0, -250]) {
      const plan = planDeliveryCost(wip, [{ itemId: CHAIR, plannedQty: 10, deliveredQty: 0 }], [line(CHAIR, 2, null, 80)]);
      expect(plan.rule).toBe('no_wip');
      expect(plan.wipCredit).toBe('0');
      expect(plan.unitCosts).toEqual(['80']);
      expect(plan.reasonNeeded).toBe('no_wip');
    }
  });

  // review of S2: receipts of before this phase may have left 1402 below zero
  it('closes a 1402 below zero with the receipt that completes the plan', () => {
    const plan = planDeliveryCost(-300, [{ itemId: CHAIR, plannedQty: 10, deliveredQty: 8 }], [line(CHAIR, 2, null, 80)]);
    expect(plan.rule).toBe('no_wip');
    expect(plan.wipCredit).toBe('-300');
    expect(plan.unitCosts).toEqual(['80']);
    expect(plan.reasonNeeded).toBe('no_wip');
  });
});

describe('the delivery tab outlook', () => {
  const report: DeliveryCostReport = {
    projectId: 1, costVisible: true, wipBalance: 1000,
    products: [{ itemId: CHAIR, plannedQty: 10, deliveredQty: 0, weightedAverageCost: 70 }],
  };

  it('shows the receipt the server records: its credit, what 1402 keeps and the variance a reason posts', () => {
    const outlook = deliveryCostOutlook(report, [{ itemId: CHAIR, quantity: 4, typedUnitCost: 120 }]);
    expect(outlook).toMatchObject({ rule: 'share', credit: 400, remaining: 600, unitCosts: [100], reasonNeeded: 'cost_changed', variance: 80 });
    expect(deliveryCostOutlook({ ...report, costVisible: false, wipBalance: null }, [])).toBeNull();
  });
});
