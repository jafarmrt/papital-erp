import { describe, expect, it } from 'vitest';
import { rebuildOrderedRows } from '../../lib/documents/procurementOrderVoid';

// TD-1195 (roles-b guide test bug 2): voiding an undelivered order rebuilds the ordered quantity from the live orders
describe('rebuildOrderedRows (TD-1195)', () => {
  it('gives the whole quantity back when no live order is left', () => {
    const [row] = rebuildOrderedRows([{ itemId: 7, requestedQty: 35, orderedQty: 35, remainingQty: 0, status: 'ordered', linkedDocumentIds: [6] }], [], new Set([7]), 6);
    expect(row).toMatchObject({ orderedQty: 0, remainingQty: 35, status: 'pending', linkedDocumentIds: [] });
  });

  it('keeps the quantity of the other live orders, filled across the rows of the item in order', () => {
    const rows = [
      { itemId: 7, requestedQty: 10, orderedQty: 10, status: 'ordered', linkedDocumentIds: [5, 6] },
      { itemId: 7, requestedQty: 10, orderedQty: 10, status: 'ordered', linkedDocumentIds: [6] },
      { itemId: 8, requestedQty: 3, orderedQty: 3, status: 'ordered', linkedDocumentIds: [5] },
    ];
    const out = rebuildOrderedRows(rows, [{ itemId: 7, quantity: 12 }, { itemId: 8, quantity: 3 }], new Set([7]), 6);
    expect(out.map(r => r.orderedQty)).toEqual([10, 2, 3]);
    expect(out.map(r => r.status)).toEqual(['ordered', 'pending', 'ordered']);
    expect(out[0].linkedDocumentIds).toEqual([5]);
    expect(out[2]).toBe(rows[2]);
  });

  it('never changes the status of a closed or received row', () => {
    const [closed, received] = rebuildOrderedRows([
      { itemId: 7, requestedQty: 10, orderedQty: 4, status: 'ordered', closed: true, linkedDocumentIds: [6] },
      { itemId: 9, requestedQty: 2, orderedQty: 2, status: 'received', linkedDocumentIds: [4] },
    ], [{ itemId: 9, quantity: 2 }], new Set([7, 9]), 6);
    expect(closed.status).toBe('ordered');
    expect(closed.orderedQty).toBe(0);
    expect(received.status).toBe('received');
  });
});
