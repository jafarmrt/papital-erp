import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canOrderRequisition, requisitionRowRemaining } from '../../lib/procurement/requisitionFields';
import { OVER_ORDER_REASON_REQUIRED, overOrdersFromError } from '../../lib/procurement/overOrderError';
import { ApiError } from '../../api';

describe('procurement remaining quantity and server over-order (OBS-R2-37)', () => {
  it('reads the remaining quantity the server wrote, and zero for a closed row', () => {
    expect(requisitionRowRemaining({ requestedQty: 10, orderedQty: 4, remainingQty: 0, closed: true })).toBe(0);
    expect(requisitionRowRemaining({ requestedQty: 10, orderedQty: 4, closed: true })).toBe(0);
    expect(requisitionRowRemaining({ requestedQty: 10, orderedQty: 4, remainingQty: 3 })).toBe(3);
    expect(requisitionRowRemaining({ requestedQty: 10, orderedQty: 4 })).toBe(6);
    expect(requisitionRowRemaining({ requestedQty: 2, orderedQty: 5 })).toBe(0);
    expect(requisitionRowRemaining({ requestedQty: '7', orderedQty: '2', remainingQty: '5' })).toBe(5);
  });

  it('does not offer an order for a requisition whose only open row was closed', () => {
    const req = { status: 'ordered', items: [{ requestedQty: 10, orderedQty: 4, remainingQty: 0, closed: true }] };
    expect(canOrderRequisition(req, { canOrder: true, canApprove: true })).toBe(false);
  });

  it('turns the server 422 into the over-order warning and ignores other errors', () => {
    const err = new ApiError('سفارش بیش از درخواست', OVER_ORDER_REASON_REQUIRED, 422, {
      overOrders: [{ itemId: 7, itemName: 'مهره', excess: 3 }, { itemId: 8, itemName: 'سنگ', excess: 0 }],
    });
    expect(overOrdersFromError(err, id => (id === 7 ? 'بسته' : 'عدد'))).toEqual([
      { key: 'server-7', itemName: 'مهره', unit: 'بسته', excess: 3 },
    ]);
    expect(overOrdersFromError(new ApiError('x', 'VALIDATION_ERROR', 422))).toEqual([]);
    expect(overOrdersFromError(null)).toEqual([]);
  });

  it('the detail table and the split-order form use the server remaining and open the reason box on the 422', () => {
    const detail = readFileSync('src/components/procurement/RequisitionDetailModal.tsx', 'utf8');
    expect(detail).toContain('const remQty = requisitionRowRemaining(row);');
    expect(detail).not.toContain('Math.max(0, reqQty - ordQty)');
    const split = readFileSync('src/components/procurement/SplitOrderModal.tsx', 'utf8');
    expect(split).toContain('setServerOverOrders(overOrdersFromError(err');
    expect(split).toContain('<OverOrderWarning items={shownOverOrders}');
    expect(split).not.toContain('it.remainingQty !== undefined');
  });
});
