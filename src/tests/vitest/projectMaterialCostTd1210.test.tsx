import { describe, expect, it } from 'vitest';
import { allocationsForCostAccess } from '../../lib/inventory/projectMaterialCost';

// v10.0.130 (TD-1210): the allocation list carries each allocation's cost only for an item cost reader.
// v10.2.3 (TD-1290): the delivery tab now reads the project's work-in-progress balance (projectMaterialsCostTd1290.test.tsx).
describe('project material cost (TD-1210)', () => {
  it('removes the cost for a reader without an item cost permission', () => {
    const rows = [{ id: 1, status: 'allocated', cost: 10 }];
    expect(allocationsForCostAccess(rows, true)).toEqual(rows);
    expect(allocationsForCostAccess(rows, false)).toEqual([{ id: 1, status: 'allocated' }]);
  });
});
