import { describe, expect, it } from 'vitest';
import { planProjectReservation } from '../../lib/projects/projectReservation';
import { directConversionRate } from '../../lib/projects/unitConversion';

// v9.0.372 (TD-820, B07-04): a project's need is converted to the item unit before it is reserved
describe('project reservation units (TD-820)', () => {
  const items = [
    { id: 1, code: 'ST-1', name: 'نخ', unit: 'ریسه', currentStock: 30 },
    { id: 2, code: 'GR-1', name: 'پودر', unit: 'گرم', currentStock: 5_000 },
    { id: 3, code: 'NU-1', name: 'بی واحد', unit: null, currentStock: 9 },
  ];
  const global = (rows: Array<Record<string, unknown>>) => [{ id: 's', title: 'مواد', checkType: 'global', globalItems: rows }];

  it('divides the requirement by the row conversion rate and never reads the rounded convertedQty', () => {
    const plan = planProjectReservation(global([
      { itemCode: 'st-1', unit: 'متر', requiredQty: 100, convertedUnit: 'ریسه', conversionRate: 5, convertedQty: 99 },
      { itemCode: 'GR-1', unit: 'کیلوگرم', requiredQty: 2, conversionRate: 0.001 },
    ]), [], items, [], 'now');
    expect(plan.unitMismatches).toEqual([]);
    expect(plan.reserved).toEqual([
      expect.objectContaining({ itemId: 1, reservedQty: 20, originalQty: 20, unit: 'ریسه', conversionRate: 5, conversionUnit: 'متر' }),
      expect.objectContaining({ itemId: 2, reservedQty: 2_000, unit: 'گرم', conversionRate: 0.001 }),
    ]);
    expect(plan.reserved[0]).not.toHaveProperty('convertedQty');
  });

  it('sums the rows of one item after conversion and compares units trimmed and case-insensitively', () => {
    const plan = planProjectReservation([
      ...global([{ itemCode: 'ST-1', unit: 'متر', requiredQty: 100, conversionRate: 5 }]),
      ...global([{ name: ' نخ ', unit: ' ریسه ', requiredQty: 3 }]),
    ], [], items, [], 'now');
    expect(plan.reserved).toHaveLength(1);
    expect(plan.reserved[0]).toMatchObject({ itemId: 1, reservedQty: 23, originalQty: 23 });
    expect(plan.reserved[0]).not.toHaveProperty('conversionRate');
  });

  it('lists a row in another unit without a valid conversion and reserves nothing for it', () => {
    const plan = planProjectReservation(global([
      { itemCode: 'GR-1', unit: 'کیلوگرم', requiredQty: 2 },
      { itemCode: 'ST-1', unit: 'متر', requiredQty: 10, conversionRate: 0 },
      { itemCode: 'ST-1', unit: 'سانتی‌متر', requiredQty: 10, conversionRate: 100, convertedUnit: 'متر' },
      { itemCode: 'ST-1', requiredQty: 4 },
      { itemCode: 'NU-1', unit: 'متر', requiredQty: 4 },
    ]), [], items, [], 'now');
    expect(plan.unitMismatches.map(m => [m.itemId, m.rowUnit, m.itemUnit])).toEqual([
      [2, 'کیلوگرم', 'گرم'], [1, 'متر', 'ریسه'], [1, 'سانتی‌متر', 'ریسه'], [1, 'عدد', 'ریسه'],
    ]);
    // an item without a unit takes the row as it is (the form shows no mismatch for it)
    expect(plan.reserved).toEqual([expect.objectContaining({ itemId: 3, reservedQty: 4 })]);
  });

  it('keeps the full conversion rate of a directly entered converted quantity', () => {
    expect(directConversionRate(2, 2_000)).toBe(0.001);
    expect(directConversionRate(100, 20)).toBe(5);
    expect(directConversionRate(0, 5)).toBe(1);
    expect(directConversionRate(5, 0)).toBe(1);
  });
});
