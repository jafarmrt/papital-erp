import { describe, expect, it } from 'vitest';
import { rebuildOrderedRows, unlinkVoidedOrder } from '../../lib/documents/procurementOrderVoid';
import { applyDeliveredLines, rebuildOrderRows, type RequisitionItemWithReceipt } from '../../services/procurement/requisitionReceipt';
import { findOverOrders, spreadOrderedQuantity } from '../../services/procurement/requisitionOrder';

// TD-1391 (v11 phase 7.2): one rule for a closed requisition row, kept by both rebuilds after a void and by the spread
const row = (r: Partial<RequisitionItemWithReceipt> & { requestedQty: number }): RequisitionItemWithReceipt =>
  ({ unit: 'عدد', itemId: 7, ...r });

describe('requisition row closure (TD-1391)', () => {
  it('keeps a legacy closed row closed when a draft order is voided (documents rebuild)', () => {
    // legacy closure: status «ordered» with less ordered than requested, no flag; the voided order 6 held B's 5
    const rows = [
      row({ requestedQty: 10, orderedQty: 4, status: 'ordered', linkedDocumentIds: [5] }),
      row({ requestedQty: 5, orderedQty: 5, status: 'ordered', linkedDocumentIds: [6] }),
    ];
    const out = rebuildOrderedRows(rows, [{ itemId: 7, quantity: 4 }], new Set([7]), 6);
    expect(out[0]).toMatchObject({ orderedQty: 4, remainingQty: 0, status: 'ordered', closed: true });
    expect(out[1]).toMatchObject({ orderedQty: 0, remainingQty: 5, status: 'pending', linkedDocumentIds: [] });
  });

  it('keeps the closed row ordered quantity and does not move it to the open row (procurement rebuild)', () => {
    const rows = [
      row({ requestedQty: 10, orderedQty: 4, status: 'ordered' }),
      row({ requestedQty: 5, orderedQty: 5, status: 'ordered' }),
    ];
    const out = rebuildOrderRows(rows, new Set([7]), [{ itemId: 7, quantity: 9 }], []);
    expect(out.map(r => r.orderedQty)).toEqual([4, 5]);
    expect(out.map(r => r.status)).toEqual(['ordered', 'ordered']);
    expect(out.map(r => r.remainingQty)).toEqual([0, 0]);
    expect(out[0].closed).toBe(true);
  });

  it('frees a closed row quantity when its own order is voided, never taking it from an open row', () => {
    // A closed at 4 through order 5, B fully ordered through order 6; order 5 is voided (only order 6 is live)
    const rows = [
      row({ requestedQty: 10, orderedQty: 4, status: 'ordered', linkedDocumentIds: [] }),
      row({ requestedQty: 5, orderedQty: 5, status: 'ordered', linkedDocumentIds: [6] }),
    ];
    const out = rebuildOrderRows(rows, new Set([7]), [{ itemId: 7, quantity: 5, documentId: 6 }], []);
    expect(out[0]).toMatchObject({ orderedQty: 0, status: 'ordered', remainingQty: 0, closed: true });
    expect(out[1]).toMatchObject({ orderedQty: 5, status: 'ordered', remainingQty: 0 });
  });

  it('keeps the closed row quantity its own live order still holds', () => {
    // order 5 holds A's 4 and 1 of B, order 6 (4 of B) is voided
    const rows = [
      row({ requestedQty: 10, orderedQty: 4, status: 'ordered', linkedDocumentIds: [5] }),
      row({ requestedQty: 5, orderedQty: 5, status: 'ordered', linkedDocumentIds: [5] }),
    ];
    const out = rebuildOrderRows(rows, new Set([7]), [{ itemId: 7, quantity: 5, documentId: 5 }], []);
    expect(out[0]).toMatchObject({ orderedQty: 4, status: 'ordered', remainingQty: 0, closed: true });
    expect(out[1]).toMatchObject({ orderedQty: 1, status: 'pending', remainingQty: 4 });
  });

  it('only unlinks the voided order when the procurement rebuild runs after it', () => {
    const rows = [row({ requestedQty: 5, orderedQty: 5, status: 'ordered', linkedDocumentIds: [5, 6] }), row({ requestedQty: 2, itemId: 8, linkedDocumentIds: [5] })];
    const out = unlinkVoidedOrder(rows, 6);
    expect(out[0]).toMatchObject({ orderedQty: 5, status: 'ordered', linkedDocumentIds: [5] });
    expect(out[1]).toBe(rows[1]);
  });

  it('lets a closed row receive no more than it had ordered', () => {
    const rows = [
      row({ requestedQty: 10, orderedQty: 4, status: 'ordered', closed: true }),
      row({ requestedQty: 5, orderedQty: 5, status: 'ordered' }),
    ];
    const out = applyDeliveredLines(rows, [{ itemId: 7, quantity: 9 }]);
    expect(out.map(r => r.receivedQty)).toEqual([4, 5]);
    expect(out[1].status).toBe('received');
  });

  it('spreads a new order over the open rows only, the last open row taking the excess', () => {
    const rows = [
      row({ requestedQty: 5, orderedQty: 0 }),
      row({ requestedQty: 10, orderedQty: 4, status: 'ordered', closed: true }),
      row({ requestedQty: 5, orderedQty: 0 }),
    ];
    const spread = spreadOrderedQuantity(rows, 12, r => r.closed === true);
    expect(spread.map(s => [rows.indexOf(s.row), s.added])).toEqual([[0, 5], [2, 7]]);
  });

  it('counts a closed row as needing only what it had ordered when checking an over-order', () => {
    const rows = [
      row({ requestedQty: 10, orderedQty: 4, status: 'ordered' }),
      row({ requestedQty: 5, orderedQty: 0, status: 'pending' }),
    ];
    expect(findOverOrders(rows, [{ itemId: 7, quantity: 5 }])).toEqual([]);
    expect(findOverOrders(rows, [{ itemId: 7, quantity: 8 }]).map(o => o.excess)).toEqual([3]);
  });

  it('takes a closed row need from the stored rows when an order edit rebuilt them from the other orders', () => {
    // the edited order X held A's 4; rebuilt from the other orders (none), A keeps 0
    const stored = [
      row({ requestedQty: 10, orderedQty: 4, status: 'ordered', closed: true }),
      row({ requestedQty: 5, orderedQty: 0, status: 'pending' }),
    ];
    const base = rebuildOrderRows(stored, new Set([7]), [], []);
    expect(findOverOrders(base, [{ itemId: 7, quantity: 9 }], stored)).toEqual([]);
    expect(findOverOrders(base, [{ itemId: 7, quantity: 11 }], stored).map(o => o.excess)).toEqual([2]);
  });
});
