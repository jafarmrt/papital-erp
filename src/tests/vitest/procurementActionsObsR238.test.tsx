import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProcurementOrder, PurchaseRequisition } from '../../types';
import { BULK_DELIVERY_ALL_DELIVERED, bulkDeliveryPlan, linkedDocumentLabel, requisitionActionButtons, requisitionStage } from '../../lib/procurement/requisitionActions';
import { REQUISITION_STATUS_BADGES } from '../../components/procurement/requisitionBadges';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({ toast: { error: (m: string) => toastError(m), success: () => undefined } }));
const granted = new Set<string>();
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ userPermissions: { permissions: [...granted], isAdmin: false } }),
  useHasPermission: (key: string) => granted.has(key),
}));

import { RequisitionDetailModal } from '../../components/procurement/RequisitionDetailModal';

// OBS-R2-38 (TD-992): the requisition detail window built its action buttons from the requisition status, not from the
// actions the server allows in the current workflow step; it showed linked documents as "#id", its bulk delivery did
// nothing when every order was delivered, and its order button promised a proforma while it records a draft order.

const SEND_TO_MANAGER = 'ارسال برای تأیید مدیر';
const APPROVE_LABEL = /تایید و صدور دستور خرید/;
const ORDER_REF = 'R-1405-0031';

const order: ProcurementOrder = {
  id: 77, refNumber: ORDER_REF, docType: 'receipt', status: 'final', date: '2026-10-06T10:00:00', supplierName: 'تامین الماس',
  notes: '', requisitionId: 8, requisitionCode: 'PR-1405-0008', projectName: null, location: 'WH1',
  totalAmount: 5000, itemsCount: 1, user: 'admin', items: [],
};

const requisitionOf = (status: PurchaseRequisition['status'], linked: number[] = []): PurchaseRequisition => ({
  id: 8, code: 'PR-1405-0008', title: 'درخواست', status, priority: 'normal', notes: '', totalEstimatedAmount: 5000,
  items: [{ id: 'r1', itemId: 9, itemCode: 'RM-9', itemName: 'سنگ', unit: 'عدد', requestedQty: 5, orderedQty: 5, remainingQty: 0, unitPriceEstimate: 1000, linkedDocumentIds: linked }],
});

function api(actions: { hasInstance: boolean; actions: { actionKey: string; title: string }[] }, orders: ProcurementOrder[] = []) {
  fetchJson.mockImplementation(async (u: unknown) => {
    const url = String(u ?? '');
    if (url.includes('/workflow-actions')) return { success: true, data: actions };
    if (url.startsWith('/api/procurement/orders')) return { success: true, data: orders };
    return { success: true, data: [] };
  });
}

const open = (req: PurchaseRequisition) =>
  render(<RequisitionDetailModal isOpen requisition={req} onClose={() => undefined} onRefresh={() => undefined} onOpenSplitOrder={() => undefined} />);

beforeEach(() => {
  fetchJson.mockReset();
  toastError.mockReset();
  granted.clear();
  for (const key of ['procurement.view', 'procurement.approve', 'procurement.order']) granted.add(key);
});
afterEach(cleanup);

describe('requisition actions come from the workflow step (OBS-R2-38)', () => {
  it('shows the step actions the server allows, by their titles', async () => {
    api({ hasInstance: true, actions: [{ actionKey: 'send_to_manager', title: SEND_TO_MANAGER }] });
    open(requisitionOf('under_review'));
    expect(await screen.findByText(SEND_TO_MANAGER)).not.toBeNull();
    expect(screen.queryByText(APPROVE_LABEL)).toBeNull();
  });

  it('offers no approval the server refuses to this user (the initiator)', async () => {
    api({ hasInstance: true, actions: [{ actionKey: 'reject_request', title: 'رد درخواست خرید' }] });
    open(requisitionOf('pending'));
    expect(await screen.findByText('رد درخواست خرید')).not.toBeNull();
    expect(screen.queryByText(APPROVE_LABEL)).toBeNull();
  });

  it('sends the chosen action key', async () => {
    api({ hasInstance: true, actions: [{ actionKey: 'send_to_manager', title: SEND_TO_MANAGER }] });
    open(requisitionOf('under_review'));
    fireEvent.click(await screen.findByText(SEND_TO_MANAGER));
    await waitFor(() => expect(fetchJson.mock.calls.some(c => String(c[0]).endsWith('/workflow-action'))).toBe(true));
    const call = fetchJson.mock.calls.find(c => String(c[0]).endsWith('/workflow-action'));
    expect(JSON.parse(String((call?.[1] as RequestInit).body)).actionKey).toBe('send_to_manager');
  });

  it('leaves receiving to order delivery and drops repeated keys', () => {
    const buttons = requisitionActionButtons([
      { actionKey: 'receive_items', title: 'تحویل' }, { actionKey: 'cancel_order', title: 'لغو' }, { actionKey: 'cancel_order', title: 'لغو' },
    ]);
    expect(buttons).toEqual([{ actionKey: 'cancel_order', label: 'لغو', tone: 'reject' }]);
  });
});

describe('labels and delivery of the requisition window (OBS-R2-38)', () => {
  it('names a linked document by the order reference, never "#id"', async () => {
    api({ hasInstance: true, actions: [] }, [order]);
    open(requisitionOf('received', [77]));
    expect(await screen.findByText(`سفارش ${ORDER_REF}`)).not.toBeNull();
    expect(screen.queryByText(/سند #/)).toBeNull();
    expect(linkedDocumentLabel(12, [], n => String(n))).toBe('سند 12');
  });

  it('says so when every order is already delivered', async () => {
    granted.add('procurement.manage');
    granted.add('warehouse.in');
    api({ hasInstance: true, actions: [] }, [order]);
    open(requisitionOf('ordered', [77]));
    fireEvent.click(await screen.findByText(/تحویل کلیه اقلام به انبار/));
    expect(toastError).toHaveBeenCalledWith(BULK_DELIVERY_ALL_DELIVERED);
    expect(bulkDeliveryPlan([{ id: 1, status: 'draft' }, { id: 2, status: 'final' }])).toEqual({ orders: [{ id: 1, status: 'draft' }] });
  });

  it('the order button records a purchase order, not a proforma', async () => {
    api({ hasInstance: true, actions: [] });
    open({ ...requisitionOf('pending'), items: [{ ...requisitionOf('pending').items[0], orderedQty: 0, remainingQty: 5 }] });
    expect(await screen.findByText('تفکیک تأمین‌کننده و صدور سفارش خرید')).not.toBeNull();
    expect(screen.queryByText(/صدور پیش‌فاکتور/)).toBeNull();
  });

  it('review and manager approval steps have their own badges', () => {
    expect(REQUISITION_STATUS_BADGES.under_review.label).not.toBe(REQUISITION_STATUS_BADGES.pending.label);
    expect(REQUISITION_STATUS_BADGES.manager_approval.label).not.toBe(REQUISITION_STATUS_BADGES.pending.label);
    expect(requisitionStage('manager_approval')).toBe('approval');
    expect(requisitionStage('completed')).toBe('received');
    expect(requisitionStage('mystery')).toBe('other');
  });
});
