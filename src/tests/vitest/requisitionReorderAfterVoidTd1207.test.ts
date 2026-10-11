import { describe, expect, it } from 'vitest';
import { canOrderRequisition, REORDERABLE_RECEIVED_STATUSES } from '../../lib/procurement/requisitionFields';
import { RECEIVED_REQUISITION_STATUSES } from '../../services/procurement/requisitionReceiveAction';

// v10.0.239 (TD-1207): voiding a delivered order reopens the requisition row (TD-912) and the server takes a new order,
// but the requisition stays received and the order button showed only for an ordered requisition

const orderer = { canOrder: true, canApprove: false };
const reopened = { requestedQty: 3, orderedQty: 0, receivedQty: 0, remainingQty: 3, status: 'pending' };
const settled = { requestedQty: 3, orderedQty: 3, receivedQty: 3, remainingQty: 0, status: 'received' };

describe('ordering a received requisition again after a void (TD-1207)', () => {
  it('offers the order button for a received requisition with a reopened row', () => {
    expect(canOrderRequisition({ status: 'received', items: [reopened, settled] }, orderer)).toBe(true);
  });

  it('does not offer it when every row of the received requisition is settled', () => {
    expect(canOrderRequisition({ status: 'received', items: [settled] }, orderer)).toBe(false);
  });

  it('does not offer it without the order permission', () => {
    expect(canOrderRequisition({ status: 'received', items: [reopened] }, { canOrder: false, canApprove: true })).toBe(false);
  });

  it('uses the server list of received statuses', () => {
    expect([...REORDERABLE_RECEIVED_STATUSES].sort()).toEqual([...RECEIVED_REQUISITION_STATUSES].sort());
  });
});
